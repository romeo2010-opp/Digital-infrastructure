import { Prisma } from "@prisma/client"
import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { toUtcMysqlDateTime, zonedDateTimeToUtcMs, zonedSqlDateTimeToUtcIso } from "../../utils/dateTime.js"
import { resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import {
  listStationPumpsWithNozzles,
  resolveNozzleForTransaction,
} from "../pumps/pumps.service.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import {
  createPromotionAwareTransaction,
  notifyUserOfCashbackAward,
} from "../promotions/transactionPricing.service.js"
import { getStationTransactionReceiptPayload } from "./receipt.service.js"
import { streamFuelReceiptPdf } from "./receipt.export.pdf.js"
import { writeCsvResponse } from "../reports/reports.export.csv.js"
import { contentDispositionAttachment, safeFilenamePart } from "../reports/reports.export.service.js"

const router = Router()

export const createTxSchema = z
  .object({
    pumpPublicId: z.string().min(8).max(64).optional(),
    nozzlePublicId: z.string().min(8).max(64),
    totalVolume: z.number().positive(),
    amount: z.number().positive(),
    paymentMethod: z.enum(["CASH", "MOBILE_MONEY", "CARD", "OTHER", "SMARTPAY"]).optional(),
    note: z.string().max(255).optional(),
    userPublicId: z.string().min(8).max(64).optional(),
    requestedLitres: z.number().positive().max(500).optional(),
    cashbackDestination: z.enum(["WALLET", "LOYALTY", "NONE"]).optional(),
    paymentReference: z.string().max(128).optional(),
  })

const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().max(128).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMethod: z.enum(["ALL", "CASH", "MOBILE_MONEY", "CARD", "OTHER", "SMARTPAY"]).optional(),
  scope: z.enum(["page", "range"]).optional(),
})

function toMysqlBoundary(datePart, timePart, timezone) {
  if (!datePart) return null
  const utcMs = zonedDateTimeToUtcMs(datePart, timePart, timezone || "Africa/Blantyre")
  const mysqlDateTime = Number.isFinite(utcMs) ? toUtcMysqlDateTime(utcMs) : null
  if (!mysqlDateTime) throw badRequest("Invalid transaction date filter")
  return mysqlDateTime
}

function normalizeTransactionQuery(query, timezone) {
  const parsed = transactionQuerySchema.parse(query || {})
  const from = parsed.from || null
  const to = parsed.to || from
  if (from && to && from > to) throw badRequest("Transaction start date cannot be after end date")

  const search = String(parsed.search || "").trim()
  return {
    page: parsed.page || 1,
    pageSize: parsed.pageSize || 10,
    search,
    searchLike: search ? `%${search}%` : null,
    from,
    to,
    fromDt: toMysqlBoundary(from, "00:00:00", timezone),
    toDt: toMysqlBoundary(to, "23:59:59", timezone),
    paymentMethod: parsed.paymentMethod && parsed.paymentMethod !== "ALL" ? parsed.paymentMethod : null,
    scope: parsed.scope || "range",
  }
}

function transactionWhereSql(stationId, filters) {
  return Prisma.sql`
    WHERE t.station_id = ${stationId}
      AND (${filters.fromDt} IS NULL OR t.occurred_at >= ${filters.fromDt})
      AND (${filters.toDt} IS NULL OR t.occurred_at <= ${filters.toDt})
      AND (${filters.paymentMethod} IS NULL OR t.payment_method = ${filters.paymentMethod})
      AND (
        ${filters.searchLike} IS NULL
        OR t.public_id LIKE ${filters.searchLike}
        OR t.receipt_verification_ref LIKE ${filters.searchLike}
        OR t.payment_method LIKE ${filters.searchLike}
        OR t.status LIKE ${filters.searchLike}
        OR t.settlement_impact_status LIKE ${filters.searchLike}
        OR ft.code LIKE ${filters.searchLike}
        OR p.public_id LIKE ${filters.searchLike}
        OR pn.public_id LIKE ${filters.searchLike}
        OR CAST(p.pump_number AS CHAR) LIKE ${filters.searchLike}
        OR CAST(pn.nozzle_number AS CHAR) LIKE ${filters.searchLike}
      )
  `
}

async function countTransactions(stationId, filters) {
  const where = transactionWhereSql(stationId, filters)
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT COUNT(*) AS total
    FROM transactions t
    LEFT JOIN pumps p ON p.id = t.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    ${where}
  `)
  return Number(rows?.[0]?.total || 0)
}

async function listTransactions(station, filters, pagination = null) {
  const where = transactionWhereSql(station.id, filters)
  const paginationSql = pagination
    ? Prisma.sql`LIMIT ${pagination.limit} OFFSET ${pagination.offset}`
    : Prisma.empty

  return prisma.$queryRaw(Prisma.sql`
    SELECT
      t.public_id,
      DATE_FORMAT(t.occurred_at, '%Y-%m-%d %H:%i:%s') AS occurred_at_local,
      CAST(t.litres AS CHAR) AS litres,
      CAST(t.total_amount AS CHAR) AS total_amount,
      CAST(t.subtotal AS CHAR) AS subtotal,
      CAST(t.total_direct_discount AS CHAR) AS total_direct_discount,
      CAST(t.cashback_total AS CHAR) AS cashback_total,
      CAST(t.final_amount_paid AS CHAR) AS final_amount_paid,
      CAST(t.effective_price_per_litre AS CHAR) AS effective_price_per_litre,
      t.payment_method,
      t.status,
      t.settlement_impact_status,
      t.workflow_reason_code,
      t.workflow_note,
      t.cancelled_at,
      t.receipt_verification_ref,
      t.cashback_status,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number,
      pn.side AS nozzle_side,
      ft.code AS fuel_code,
      tx_case.case_public_id AS compliance_case_public_id,
      tx_case.case_status AS compliance_case_status
    FROM transactions t
    LEFT JOIN pumps p ON p.id = t.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN (
      SELECT
        ial.target_public_id AS transaction_public_id,
        JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId')) AS case_public_id,
        cc.status AS case_status,
        ROW_NUMBER() OVER (
          PARTITION BY ial.target_public_id
          ORDER BY ial.created_at DESC
        ) AS row_num
      FROM internal_audit_log ial
      LEFT JOIN compliance_cases cc
        ON cc.public_id = JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId'))
      WHERE ial.target_type = 'TRANSACTION'
        AND JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId') IS NOT NULL
    ) tx_case
      ON tx_case.transaction_public_id = t.public_id
     AND tx_case.row_num = 1
    ${where}
    ORDER BY t.occurred_at DESC, t.id DESC
    ${paginationSql}
  `)
}

function mapTransactionRow(row, timezone) {
  return {
    public_id: row.public_id,
    occurred_at: zonedSqlDateTimeToUtcIso(row.occurred_at_local, timezone),
    litres: row.litres,
    total_amount: row.total_amount,
    subtotal: row.subtotal,
    total_direct_discount: row.total_direct_discount,
    cashback_total: row.cashback_total,
    final_amount_paid: row.final_amount_paid,
    effective_price_per_litre: row.effective_price_per_litre,
    payment_method: row.payment_method,
    status: row.status || "RECORDED",
    settlement_impact_status: row.settlement_impact_status || "UNCHANGED",
    workflow_reason_code: row.workflow_reason_code || null,
    workflow_note: row.workflow_note || null,
    cancelled_at: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    receipt_verification_ref: row.receipt_verification_ref || null,
    cashback_status: row.cashback_status || "NONE",
    compliance_case_public_id: row.compliance_case_public_id || null,
    compliance_case_status: row.compliance_case_status || null,
    pump_public_id: row.pump_public_id,
    pump_number: row.pump_number,
    nozzle_public_id: row.nozzle_public_id,
    nozzle_number: row.nozzle_number,
    nozzle_side: row.nozzle_side,
    fuel_code: row.fuel_code,
  }
}

async function resolveActorStaffId(stationId, userId) {
  if (!userId) return null
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM station_staff
    WHERE station_id = ${stationId}
      AND user_id = ${userId}
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0]?.id || null
}

async function resolveStationContext(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, timezone
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  return rows?.[0] || { ...station, timezone: "Africa/Blantyre" }
}

async function resolveUserIdByPublicId(userPublicId) {
  const scopedUserPublicId = String(userPublicId || "").trim()
  if (!scopedUserPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE public_id = ${scopedUserPublicId}
      AND is_active = 1
    LIMIT 1
  `
  return Number(rows?.[0]?.id || 0) || null
}

router.get(
  "/stations/:stationPublicId/transactions/pumps",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const rows = await listStationPumpsWithNozzles(station.id, { includeInactive: false })
    return ok(res, rows)
  })
)

router.get(
  "/stations/:stationPublicId/transactions",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const filters = normalizeTransactionQuery(req.query, station.timezone)
    const total = await countTransactions(station.id, filters)
    const totalPages = Math.max(1, Math.ceil(total / filters.pageSize))
    const page = Math.min(filters.page, totalPages)
    const rows = await listTransactions(station, filters, {
      limit: filters.pageSize,
      offset: (page - 1) * filters.pageSize,
    })
    return ok(
      res,
      {
        items: (rows || []).map((row) => mapTransactionRow(row, station.timezone)),
        total,
        page,
        pageSize: filters.pageSize,
        totalPages,
      }
    )
  })
)

router.post(
  "/stations/:stationPublicId/transactions",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = createTxSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const userId = await resolveUserIdByPublicId(body.userPublicId)

    const litres = Number(body.totalVolume)
    const amount = Number(body.amount)
    if (litres <= 0) throw badRequest("Total volume must be greater than 0")
    if (amount <= 0) throw badRequest("Amount must be greater than 0")

    const { nozzle } = await resolveNozzleForTransaction({
      stationId: station.id,
      nozzlePublicId: body.nozzlePublicId || null,
      pumpPublicId: body.pumpPublicId || null,
    })

    if (!nozzle?.id) throw badRequest("Unable to resolve nozzle for transaction")
    if (!Number(nozzle.fuel_type_id)) throw badRequest("Resolved nozzle has no fuel type")
    const occurredAt = new Date()

    const created = await prisma.$transaction((tx) =>
      createPromotionAwareTransaction(tx, {
        stationId: station.id,
        fuelTypeCode: String(nozzle.fuel_code || "").trim().toUpperCase() || String(nozzle.fuel_type_code || "").trim().toUpperCase(),
        litres,
        paymentMethod: body.paymentMethod || "CASH",
        amount,
        userId,
        actorStaffId,
        actorUserId: req.auth?.userId || null,
        pumpId: nozzle.pump_id ? Number(nozzle.pump_id) : null,
        nozzleId: Number(nozzle.id),
        note: body.note || null,
        occurredAt,
        paymentReference: body.paymentReference || null,
        requestedLitres: body.requestedLitres || null,
        cashbackDestination: body.cashbackDestination || "WALLET",
        allowLegacyAmountMismatch: true,
      })
    )

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "TRANSACTION_CREATE",
      payload: {
        pumpPublicId: body.pumpPublicId || nozzle.pump_public_id || null,
        nozzlePublicId: body.nozzlePublicId || nozzle.public_id || null,
        totalVolume: litres,
        amount,
        paymentMethod: body.paymentMethod || "CASH",
        userPublicId: body.userPublicId || null,
        receiptVerificationRef: created?.transaction?.receiptVerificationRef || null,
        promoLabelsApplied: created?.pricing?.promoLabelsApplied || [],
      },
    })

    await notifyUserOfCashbackAward({
      userId,
      station,
      transaction: created?.transaction || null,
      pricing: created?.pricing || null,
    })

    return ok(
      res,
      {
        public_id: created?.transaction?.publicId || null,
        occurred_at: created?.transaction?.occurredAt || occurredAt.toISOString(),
        litres: created?.transaction?.litres ?? litres,
        total_amount: created?.transaction?.totalAmount ?? amount,
        subtotal: created?.pricing?.subtotal ?? null,
        total_direct_discount: created?.pricing?.totalDirectDiscount ?? 0,
        cashback_total: created?.pricing?.cashback ?? 0,
        final_amount_paid: created?.pricing?.finalPayable ?? amount,
        effective_price_per_litre: created?.pricing?.effectivePricePerLitre ?? null,
        payment_method: body.paymentMethod || "CASH",
        status: "RECORDED",
        settlement_impact_status: "UNCHANGED",
        workflow_reason_code: null,
        workflow_note: null,
        cancelled_at: null,
        pump_public_id: body.pumpPublicId || nozzle.pump_public_id || null,
        pump_number: nozzle.pump_number || null,
        nozzle_public_id: body.nozzlePublicId || nozzle.public_id || null,
        nozzle_number: nozzle.nozzle_number || null,
        nozzle_side: nozzle.side || null,
        fuel_code: String(nozzle.fuel_code || "").trim().toUpperCase() || null,
        receipt_verification_ref: created?.transaction?.receiptVerificationRef || null,
        cashback_status: created?.transaction?.cashbackStatus || "NONE",
        pricing: created?.pricing || null,
      },
      201
    )
  })
)

router.get(
  "/stations/:stationPublicId/transactions/export/csv",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const filters = normalizeTransactionQuery(req.query, station.timezone)
    const shouldPage = filters.scope === "page"
    const rows = await listTransactions(
      station,
      filters,
      shouldPage
        ? {
            limit: filters.pageSize,
            offset: (filters.page - 1) * filters.pageSize,
          }
        : null
    )
    const mappedRows = (rows || []).map((row) => mapTransactionRow(row, station.timezone))
    const exportRange = filters.from && filters.to ? `${filters.from}_to_${filters.to}` : "all"
    const filename = `smartlink_${safeFilenamePart(station.public_id)}_transactions_${exportRange}.csv`

    res.status(200)
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", contentDispositionAttachment(filename))
    res.setHeader("Cache-Control", "no-store")
    writeCsvResponse({
      res,
      columns: [
        { key: "public_id", header: "Transaction ID" },
        { key: "occurred_at", header: "Occurred At" },
        { key: "fuel_code", header: "Fuel Type" },
        { key: "pump_public_id", header: "Pump Public ID" },
        { key: "pump_number", header: "Pump Number" },
        { key: "nozzle_public_id", header: "Nozzle Public ID" },
        { key: "nozzle_number", header: "Nozzle Number" },
        { key: "nozzle_side", header: "Nozzle Side" },
        { key: "litres", header: "Litres" },
        { key: "subtotal", header: "Subtotal" },
        { key: "total_direct_discount", header: "Direct Discount" },
        { key: "cashback_total", header: "Cashback" },
        { key: "final_amount_paid", header: "Final Amount Paid" },
        { key: "payment_method", header: "Payment Method" },
        { key: "status", header: "Transaction Status" },
        { key: "settlement_impact_status", header: "Settlement Impact" },
        { key: "receipt_verification_ref", header: "Receipt Verification Ref" },
        { key: "cashback_status", header: "Cashback Status" },
        { key: "compliance_case_public_id", header: "Compliance Case ID" },
        { key: "compliance_case_status", header: "Compliance Case Status" },
        { key: "workflow_reason_code", header: "Workflow Reason" },
        { key: "workflow_note", header: "Workflow Note" },
      ],
      rows: mappedRows,
    })
    res.end()
  })
)

router.get(
  "/stations/:stationPublicId/transactions/:transactionPublicId/receipt",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const receipt = await getStationTransactionReceiptPayload(
      req.params.stationPublicId,
      req.params.transactionPublicId
    )
    return ok(res, receipt)
  })
)

router.get(
  "/stations/:stationPublicId/transactions/:transactionPublicId/receipt/download",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const receipt = await getStationTransactionReceiptPayload(
      req.params.stationPublicId,
      req.params.transactionPublicId
    )
    const filename = `smartlink_${safeFilenamePart(receipt.transactionId || req.params.transactionPublicId)}_receipt.pdf`
    res.status(200)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", contentDispositionAttachment(filename))
    res.setHeader("Cache-Control", "no-store")

    await streamFuelReceiptPdf({
      res,
      receipt,
    })
  })
)

export default router

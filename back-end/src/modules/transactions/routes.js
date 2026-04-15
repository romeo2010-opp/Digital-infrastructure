import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { zonedSqlDateTimeToUtcIso } from "../../utils/dateTime.js"
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
    const rows = await prisma.$queryRaw`
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
      WHERE t.station_id = ${station.id}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT 50
    `
    return ok(
      res,
      (rows || []).map((row) => ({
        public_id: row.public_id,
        occurred_at: zonedSqlDateTimeToUtcIso(row.occurred_at_local, station.timezone),
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
      }))
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

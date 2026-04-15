import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildVerificationUrl(reference) {
  const baseUrl = String(process.env.RECEIPT_VERIFY_BASE_URL || process.env.PUBLIC_WEB_BASE_URL || "https://smartlink.mw")
    .trim()
    .replace(/\/+$/, "")
  return `${baseUrl}/verify/receipts/${encodeURIComponent(reference)}`
}

function normalizePromotionKind(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "FLASH_PRICE") return "Flash Price"
  if (normalized === "CASHBACK") return "Cashback"
  if (normalized === "DISCOUNT") return "Discount"
  return "-"
}

function formatPromotionValueLabel({
  discountMode = null,
  discountValue = null,
  cashbackMode = null,
  cashbackValue = null,
  flashPricePerLitre = null,
} = {}) {
  const normalizedDiscountMode = String(discountMode || "").trim().toUpperCase()
  const normalizedCashbackMode = String(cashbackMode || "").trim().toUpperCase()
  const normalizedDiscountValue = toNumberOrNull(discountValue)
  const normalizedCashbackValue = toNumberOrNull(cashbackValue)
  const normalizedFlashPrice = toNumberOrNull(flashPricePerLitre)

  if (normalizedDiscountMode === "PERCENTAGE_PER_LITRE" && normalizedDiscountValue !== null) {
    return `${normalizedDiscountValue}%/L`
  }
  if (normalizedDiscountMode === "FIXED_PER_LITRE" && normalizedDiscountValue !== null) {
    return `MWK ${normalizedDiscountValue.toLocaleString()}/L`
  }
  if (normalizedDiscountMode === "FIXED_BASKET" && normalizedDiscountValue !== null) {
    return `MWK ${normalizedDiscountValue.toLocaleString()} basket`
  }
  if (normalizedDiscountMode === "FLASH_PRICE_PER_LITRE") {
    return normalizedFlashPrice !== null ? `MWK ${normalizedFlashPrice.toLocaleString()}/L` : "-"
  }
  if (normalizedCashbackMode === "PERCENTAGE" && normalizedCashbackValue !== null) {
    return `${normalizedCashbackValue}% cashback`
  }
  if (normalizedCashbackMode === "FIXED_AMOUNT" && normalizedCashbackValue !== null) {
    return `MWK ${normalizedCashbackValue.toLocaleString()} cashback`
  }
  return "-"
}

function buildDiscountLines(redemptions, snapshot = {}) {
  if (Array.isArray(redemptions) && redemptions.length) {
    return redemptions
      .filter((row) => Number(row?.direct_discount_amount || 0) > 0)
      .map((row) => {
        const campaignSnapshot = parseJsonObject(row?.snapshot_json)
        return {
          label: String(row?.campaign_label || row?.campaign_name || "-").trim() || "-",
          amount: Number(row?.direct_discount_amount || 0),
          fundingSource: String(row?.funding_source || "").trim().toUpperCase() || null,
          promotionKind: normalizePromotionKind(row?.promotion_kind),
          promotionValueLabel: formatPromotionValueLabel({
            discountMode: campaignSnapshot?.discountMode,
            discountValue: campaignSnapshot?.discountValue,
            flashPricePerLitre: campaignSnapshot?.flashPricePerLitre,
          }),
        }
      })
  }

  const labels = Array.isArray(snapshot?.promoLabelsApplied) ? snapshot.promoLabelsApplied : []
  const total = Number(snapshot?.totalDirectDiscount || 0)
  if (!labels.length || total <= 0) return []
  return [{
    label: labels.join(", "),
    amount: total,
    fundingSource: null,
    promotionKind: "-",
    promotionValueLabel: "-",
  }]
}

function buildCashbackLines(redemptions, snapshot = {}, transactionRow = {}) {
  if (Array.isArray(redemptions) && redemptions.length) {
    return redemptions
      .filter((row) => Number(row?.cashback_amount || 0) > 0)
      .map((row) => {
        const campaignSnapshot = parseJsonObject(row?.snapshot_json)
        return {
          label: String(row?.campaign_label || row?.campaign_name || "-").trim() || "-",
          amount: Number(row?.cashback_amount || 0),
          promotionKind: normalizePromotionKind(row?.promotion_kind) || "Cashback",
          promotionValueLabel: formatPromotionValueLabel({
            cashbackMode: campaignSnapshot?.cashbackMode,
            cashbackValue: campaignSnapshot?.cashbackValue,
          }),
          status: String(row?.cashback_status || transactionRow?.cashback_status || "").trim().toUpperCase() || "EARNED",
          destination:
            String(row?.cashback_destination || transactionRow?.cashback_destination || "").trim().toUpperCase() || "WALLET",
        }
      })
  }

  const cashback = Number(snapshot?.cashback || transactionRow?.cashback_total || 0)
  if (cashback <= 0) return []
  return [{
    label: "SmartLink Cashback",
    amount: cashback,
    promotionKind: "Cashback",
    promotionValueLabel: "-",
    status: String(transactionRow?.cashback_status || "EARNED").trim().toUpperCase() || "EARNED",
    destination: String(transactionRow?.cashback_destination || "WALLET").trim().toUpperCase() || "WALLET",
  }]
}

function buildNozzleLabel(row) {
  if (!row?.nozzle_number) return "-"
  const side = String(row?.nozzle_side || "").trim()
  return side ? `${row.nozzle_number} (${side})` : String(row.nozzle_number)
}

function extractLinkedTransactionPublicIdFromMetadata(metadataValue) {
  const metadata = typeof metadataValue === "string" ? parseJsonObject(metadataValue) : metadataValue
  const serviceTransaction =
    metadata?.serviceTransaction && typeof metadata.serviceTransaction === "object"
      ? metadata.serviceTransaction
      : null
  return String(serviceTransaction?.publicId || "").trim() || null
}

export function buildReceiptPayload(row, redemptions = []) {
  const snapshot = parseJsonObject(row?.pricing_snapshot_json)
  const promoLabelsApplied =
    Array.isArray(snapshot?.promoLabelsApplied) ? snapshot.promoLabelsApplied : parseJsonArray(row?.promo_labels_applied)

  const basePricePerLitre = toNumberOrNull(row?.base_price_per_litre)
    ?? toNumberOrNull(snapshot?.basePricePerLitre)
    ?? toNumberOrNull(row?.price_per_litre)
    ?? 0
  const proofLitres = toNumberOrNull(row?.dispensed_litres)
  const proofWalletAmount = toNumberOrNull(row?.wallet_amount)
  const litres = proofLitres ?? toNumberOrNull(row?.litres) ?? toNumberOrNull(snapshot?.litres) ?? 0
  const baseSubtotal = (
    proofLitres !== null && basePricePerLitre > 0
      ? Number((basePricePerLitre * litres).toFixed(2))
      : null
  )
    ?? toNumberOrNull(row?.subtotal)
    ?? toNumberOrNull(snapshot?.subtotal)
    ?? Number((basePricePerLitre * litres).toFixed(2))
  const totalDirectDiscount = toNumberOrNull(row?.total_direct_discount)
    ?? toNumberOrNull(snapshot?.totalDirectDiscount)
    ?? 0
  const cashbackTotal = toNumberOrNull(row?.cashback_total)
    ?? toNumberOrNull(snapshot?.cashback)
    ?? 0
  const finalAmountPaid = proofWalletAmount
    ?? toNumberOrNull(row?.final_amount_paid)
    ?? toNumberOrNull(row?.total_amount)
    ?? toNumberOrNull(snapshot?.finalPayable)
    ?? 0
  const effectivePricePerLitre = (
    (proofLitres !== null || proofWalletAmount !== null) &&
    litres > 0 &&
    finalAmountPaid > 0
      ? Number((finalAmountPaid / litres).toFixed(4))
      : null
  )
    ?? toNumberOrNull(row?.effective_price_per_litre)
    ?? toNumberOrNull(snapshot?.effectivePricePerLitre)
    ?? 0

  return {
    title: "Fuel Receipt",
    subtitle: "SmartLink verified fuel transaction",
    systemName: "SmartLink",
    transactionId: String(row?.public_id || "").trim(),
    reference: String(row?.payment_reference || row?.public_id || "").trim(),
    stationName: String(row?.station_name || "Station").trim() || "Station",
    stationLocation:
      String(row?.station_location || row?.station_city || row?.station_address || "").trim() || "-",
    occurredAt: toIsoOrNull(row?.occurred_at),
    pumpNumber: Number(row?.pump_number || 0) || null,
    nozzleLabel: buildNozzleLabel(row),
    fuelType: String(row?.fuel_code || "").trim().toUpperCase() || "-",
    litres,
    unitPrice: basePricePerLitre,
    baseSubtotal,
    discountLines: buildDiscountLines(redemptions, snapshot),
    totalDirectDiscount,
    promoLabelsApplied,
    cashbackLines: buildCashbackLines(redemptions, snapshot, row),
    cashbackTotal,
    cashbackStatus: String(row?.cashback_status || "").trim().toUpperCase() || "NONE",
    cashbackDestination: String(row?.cashback_destination || "").trim().toUpperCase() || "NONE",
    cashbackCreditedAt: toIsoOrNull(row?.cashback_credited_at),
    finalAmountPaid,
    effectivePricePerLitre,
    paymentMethod: String(row?.payment_method || "").trim().toUpperCase() || "OTHER",
    fuelOrderId: String(row?.fuel_order_public_id || "").trim() || null,
    queueJoinId: String(row?.queue_public_id || "").trim() || null,
    reservationId: String(row?.reservation_public_id || "").trim() || null,
    loyaltyPointsEarned: null,
    verificationReference: String(row?.receipt_verification_ref || row?.public_id || "").trim(),
    verificationUrl: buildVerificationUrl(String(row?.receipt_verification_ref || row?.public_id || "").trim()),
    paymentReference: String(row?.payment_reference || "").trim() || null,
  }
}

async function loadPromotionRedemptions(transactionId) {
  if (!Number.isFinite(Number(transactionId || 0)) || Number(transactionId) <= 0) return []
  const rows = await prisma.$queryRaw`
    SELECT
      pr.*,
      pc.name AS campaign_name,
      pc.campaign_label,
      pc.funding_source,
      pc.promotion_kind
    FROM promotion_redemptions pr
    INNER JOIN promotion_campaigns pc ON pc.id = pr.campaign_id
    WHERE pr.transaction_id = ${transactionId}
    ORDER BY pr.created_at ASC, pr.id ASC
  `
  return rows || []
}

async function loadTransactionRowByPublicId(transactionPublicId, { stationPublicId = null, userId = null } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT
      t.*,
      st.name AS station_name,
      st.city AS station_city,
      st.address AS station_address,
      CONCAT_WS(', ', NULLIF(st.address, ''), NULLIF(st.city, '')) AS station_location,
      p.pump_number,
      pn.nozzle_number,
      pn.side AS nozzle_side,
      ft.code AS fuel_code,
      fo.public_id AS fuel_order_public_id,
      qe.public_id AS queue_public_id
    FROM transactions t
    INNER JOIN stations st ON st.id = t.station_id
    LEFT JOIN pumps p ON p.id = t.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN fuel_orders fo ON fo.id = t.fuel_order_id
    LEFT JOIN queue_entries qe ON qe.id = t.queue_entry_id
    WHERE t.public_id = ${transactionPublicId}
      AND (${stationPublicId} IS NULL OR st.public_id = ${stationPublicId})
      AND (${userId} IS NULL OR t.user_id = ${userId})
    LIMIT 1
  `
  return rows?.[0] || null
}

async function loadTransactionRowByReceiptReference(reference) {
  const rows = await prisma.$queryRaw`
    SELECT
      t.*,
      st.name AS station_name,
      st.city AS station_city,
      st.address AS station_address,
      CONCAT_WS(', ', NULLIF(st.address, ''), NULLIF(st.city, '')) AS station_location,
      p.pump_number,
      pn.nozzle_number,
      pn.side AS nozzle_side,
      ft.code AS fuel_code,
      fo.public_id AS fuel_order_public_id,
      qe.public_id AS queue_public_id
    FROM transactions t
    INNER JOIN stations st ON st.id = t.station_id
    LEFT JOIN pumps p ON p.id = t.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN fuel_orders fo ON fo.id = t.fuel_order_id
    LEFT JOIN queue_entries qe ON qe.id = t.queue_entry_id
    WHERE t.receipt_verification_ref = ${reference}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function loadUserLinkedTransactionPublicId({ userId, receiptType, reference }) {
  const scopedReceiptType = String(receiptType || "").trim().toLowerCase()
  const scopedReference = String(reference || "").trim()
  if (!scopedReference) return null

  if (scopedReceiptType === "reservation") {
    const rows = await prisma.$queryRaw`
      SELECT metadata
      FROM user_reservations
      WHERE user_id = ${userId}
        AND public_id = ${scopedReference}
      LIMIT 1
    `
    return extractLinkedTransactionPublicIdFromMetadata(rows?.[0]?.metadata)
  }

  if (scopedReceiptType === "queue") {
    const rows = await prisma.$queryRaw`
      SELECT metadata
      FROM queue_entries
      WHERE user_id = ${userId}
        AND public_id = ${scopedReference}
      LIMIT 1
    `
    const directLinkedTransactionPublicId = extractLinkedTransactionPublicIdFromMetadata(rows?.[0]?.metadata)
    if (directLinkedTransactionPublicId) return directLinkedTransactionPublicId

    const reservationRows = await prisma.$queryRaw`
      SELECT ur.metadata
      FROM user_reservations ur
      INNER JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
      WHERE ur.user_id = ${userId}
        AND qe.public_id = ${scopedReference}
      ORDER BY ur.updated_at DESC, ur.id DESC
      LIMIT 1
    `
    return extractLinkedTransactionPublicIdFromMetadata(reservationRows?.[0]?.metadata)
  }

  return null
}

async function loadReceiptWalletAmount(row) {
  if (!row?.public_id && !row?.fuel_order_public_id && !row?.reservation_public_id && !row?.queue_public_id && !row?.payment_reference) {
    return null
  }

  const rows = await prisma.$queryRaw`
    SELECT lt.net_amount, lt.gross_amount
    FROM ledger_transactions lt
    WHERE lt.transaction_status = 'POSTED'
      AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
      AND (
        (${String(row?.public_id || "")} <> '' AND lt.external_reference = ${String(row?.public_id || "")})
        OR (${String(row?.fuel_order_public_id || "")} <> '' AND lt.related_entity_type = 'FUEL_ORDER' AND lt.related_entity_id = ${String(row?.fuel_order_public_id || "")})
        OR (${String(row?.reservation_public_id || "")} <> '' AND lt.related_entity_type = 'RESERVATION' AND lt.related_entity_id = ${String(row?.reservation_public_id || "")})
        OR (${String(row?.queue_public_id || "")} <> '' AND lt.related_entity_type = 'QUEUE' AND lt.related_entity_id = ${String(row?.queue_public_id || "")})
        OR (${String(row?.payment_reference || "")} <> '' AND lt.transaction_reference = ${String(row?.payment_reference || "")})
      )
    ORDER BY lt.id DESC
    LIMIT 1
  `

  const amount = Number(rows?.[0]?.net_amount ?? rows?.[0]?.gross_amount)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

async function loadReceiptDispensedLitres(row) {
  if (!Number.isFinite(Number(row?.id || 0)) || Number(row?.id) <= 0) return null

  const rows = await prisma.$queryRaw`
    SELECT ps.dispensed_litres
    FROM pump_sessions ps
    WHERE ps.transaction_id = ${Number(row?.id || 0)}
    ORDER BY COALESCE(ps.end_time, ps.updated_at, ps.created_at) DESC, ps.id DESC
    LIMIT 1
  `

  const litres = toNumberOrNull(rows?.[0]?.dispensed_litres)
  return litres !== null && litres > 0 ? litres : null
}

async function enrichReceiptRowWithProof(row) {
  if (!row?.id) return row
  const [walletAmount, dispensedLitres] = await Promise.all([
    loadReceiptWalletAmount(row),
    loadReceiptDispensedLitres(row),
  ])

  return {
    ...row,
    wallet_amount: walletAmount ?? row?.wallet_amount ?? null,
    dispensed_litres: dispensedLitres ?? row?.dispensed_litres ?? null,
  }
}

export async function getStationTransactionReceiptPayload(stationPublicId, transactionPublicId) {
  const row = await loadTransactionRowByPublicId(transactionPublicId, { stationPublicId })
  if (!row?.id) throw notFound("Transaction receipt not found.")
  const redemptions = await loadPromotionRedemptions(row.id)
  return buildReceiptPayload(row, redemptions)
}

export async function getReceiptVerificationPayload(reference) {
  const scopedReference = String(reference || "").trim()
  if (!scopedReference) throw badRequest("Receipt verification reference is required.")
  const row = await loadTransactionRowByReceiptReference(scopedReference)
  if (!row?.id) throw notFound("Receipt verification reference not found.")
  const redemptions = await loadPromotionRedemptions(row.id)
  const receipt = buildReceiptPayload(row, redemptions)

  return {
    verified: true,
    verificationReference: scopedReference,
    verifiedAt: new Date().toISOString(),
    transaction: {
      publicId: receipt.transactionId,
      occurredAt: receipt.occurredAt,
      stationName: receipt.stationName,
      stationLocation: receipt.stationLocation,
      fuelType: receipt.fuelType,
      litres: receipt.litres,
      pumpNumber: receipt.pumpNumber,
      nozzleLabel: receipt.nozzleLabel,
      paymentMethod: receipt.paymentMethod,
    },
    pricing: {
      unitPrice: receipt.unitPrice,
      baseSubtotal: receipt.baseSubtotal,
      totalDirectDiscount: receipt.totalDirectDiscount,
      cashbackTotal: receipt.cashbackTotal,
      finalAmountPaid: receipt.finalAmountPaid,
      effectivePricePerLitre: receipt.effectivePricePerLitre,
      promoLabelsApplied: receipt.promoLabelsApplied,
    },
    discountLines: receipt.discountLines,
    cashbackLines: receipt.cashbackLines,
    verificationUrl: receipt.verificationUrl,
  }
}

export async function getUserTransactionReceiptPayloadByLink({ userId, receiptType, reference }) {
  const scopedReceiptType = String(receiptType || "").trim().toLowerCase()
  const scopedReference = String(reference || "").trim()
  if (!scopedReference) throw badRequest("Receipt reference is required.")

  let row = null
  if (scopedReceiptType === "reservation") {
    const rows = await prisma.$queryRaw`
      SELECT
        t.*,
        st.name AS station_name,
        st.city AS station_city,
        st.address AS station_address,
        CONCAT_WS(', ', NULLIF(st.address, ''), NULLIF(st.city, '')) AS station_location,
        p.pump_number,
        pn.nozzle_number,
        pn.side AS nozzle_side,
        ft.code AS fuel_code,
        fo.public_id AS fuel_order_public_id,
        qe.public_id AS queue_public_id
      FROM transactions t
      INNER JOIN stations st ON st.id = t.station_id
      LEFT JOIN pumps p ON p.id = t.pump_id
      LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
      LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN fuel_orders fo ON fo.id = t.fuel_order_id
      LEFT JOIN queue_entries qe ON qe.id = t.queue_entry_id
      WHERE t.user_id = ${userId}
        AND t.reservation_public_id = ${scopedReference}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT 1
    `
    row = rows?.[0] || null
  } else if (scopedReceiptType === "queue") {
    const rows = await prisma.$queryRaw`
      SELECT
        t.*,
        st.name AS station_name,
        st.city AS station_city,
        st.address AS station_address,
        CONCAT_WS(', ', NULLIF(st.address, ''), NULLIF(st.city, '')) AS station_location,
        p.pump_number,
        pn.nozzle_number,
        pn.side AS nozzle_side,
        ft.code AS fuel_code,
        fo.public_id AS fuel_order_public_id,
        qe.public_id AS queue_public_id
      FROM transactions t
      INNER JOIN stations st ON st.id = t.station_id
      LEFT JOIN pumps p ON p.id = t.pump_id
      LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
      LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN fuel_orders fo ON fo.id = t.fuel_order_id
      LEFT JOIN queue_entries qe ON qe.id = t.queue_entry_id
      WHERE t.user_id = ${userId}
        AND qe.public_id = ${scopedReference}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT 1
    `
    row = rows?.[0] || null
  } else {
    throw badRequest("receiptType must be queue or reservation.")
  }

  if (!row?.id) {
    const transactionPublicId = await loadUserLinkedTransactionPublicId({
      userId,
      receiptType: scopedReceiptType,
      reference: scopedReference,
    })
    if (transactionPublicId) {
      row = await loadTransactionRowByPublicId(transactionPublicId, { userId })
    }
  }

  if (!row?.id) return null
  row = await enrichReceiptRowWithProof(row)
  const redemptions = await loadPromotionRedemptions(row.id)
  return buildReceiptPayload(row, redemptions)
}

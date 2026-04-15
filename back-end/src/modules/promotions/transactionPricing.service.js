import { badRequest, notFound } from "../../utils/http.js"
import { formatDateTimeSqlInTimeZone, getAppTimeZone } from "../../utils/dateTime.js"
import { createPublicId, createTransactionPublicIdValue } from "../common/db.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import { createWalletCashbackCredit } from "../common/wallets.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import { calculateTransactionPricing } from "./pricing.engine.js"
import { linkTransactionToPumpSession } from "../monitoring/pumpSessionLink.service.js"
import {
  incrementPromotionRedemptionCounters,
  resolveFuelPricePerLitre,
} from "./service.js"

function roundMoney(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function roundUnit(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(4))
}

function roundLitres(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(3))
}

function formatMoney(value) {
  return `MWK ${roundMoney(value).toLocaleString()}`
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeFuelTypeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16)
}

function normalizeCashbackDestination(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["WALLET", "LOYALTY", "NONE"].includes(normalized)) return normalized
  return "WALLET"
}

export function buildCashbackAwardNotification({
  station = null,
  transaction = null,
  pricing = null,
  reservationPublicId = null,
} = {}) {
  const cashbackAmount = roundMoney(pricing?.cashback)
  if (cashbackAmount <= 0) return null

  const cashbackDestination = normalizeCashbackDestination(
    transaction?.cashbackDestination || pricing?.cashbackDestination || "WALLET"
  )
  if (cashbackDestination === "NONE") return null

  const cashbackStatus = String(transaction?.cashbackStatus || pricing?.cashbackStatus || "EARNED").trim().toUpperCase()
  const stationName = String(station?.name || transaction?.stationName || "your station").trim() || "your station"
  const transactionPublicId = String(transaction?.publicId || "").trim() || null
  const receiptVerificationRef = String(transaction?.receiptVerificationRef || "").trim() || null
  const promoLabelsApplied = Array.isArray(pricing?.promoLabelsApplied)
    ? pricing.promoLabelsApplied.filter(Boolean)
    : []

  let title = "Cashback earned"
  let body = `${formatMoney(cashbackAmount)} cashback was earned from your purchase at ${stationName}.`

  if (cashbackDestination === "WALLET" && cashbackStatus === "CREDITED") {
    title = "Cashback credited"
    body = `${formatMoney(cashbackAmount)} cashback has been returned to your wallet from your purchase at ${stationName}.`
  } else if (cashbackDestination === "LOYALTY") {
    title = "Cashback recorded"
    body = `${formatMoney(cashbackAmount)} cashback has been recorded for your purchase at ${stationName}.`
  }

  return {
    title,
    body,
    metadata: {
      event: "cashback_awarded",
      cashbackAmount,
      cashbackStatus,
      cashbackDestination,
      transactionPublicId,
      receiptVerificationRef,
      reservationPublicId: String(reservationPublicId || "").trim() || null,
      stationPublicId: String(station?.public_id || station?.publicId || transaction?.stationPublicId || "").trim() || null,
      stationName,
      promoLabelsApplied,
      cashbackWalletTransactionReference:
        String(transaction?.cashbackWalletTransactionReference || pricing?.cashbackWalletTransactionReference || "").trim() || null,
    },
  }
}

export async function notifyUserOfCashbackAward({
  userId,
  station = null,
  transaction = null,
  pricing = null,
  reservationPublicId = null,
} = {}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  const notification = buildCashbackAwardNotification({
    station,
    transaction,
    pricing,
    reservationPublicId,
  })
  if (!notification) return null

  let alert = null
  try {
    await ensureUserAlertsTableReady()
    alert = await createUserAlert({
      userId: normalizedUserId,
      stationId: Number(station?.id || 0) || null,
      reservationPublicId: String(reservationPublicId || "").trim() || null,
      category: "SYSTEM",
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
    })

    publishUserAlert({
      userId: normalizedUserId,
      eventType: "user_alert:new",
      data: alert,
    })
  } catch (error) {
    console.warn("Failed to persist cashback user alert", error?.message || error)
  }

  try {
    await sendPushAlertToUser({
      userId: normalizedUserId,
      notification: {
        title: alert?.title || notification.title,
        body: alert?.message || notification.body,
        tag: alert?.publicId || transaction?.publicId || `cashback-${Date.now()}`,
        url: "/m/alerts",
        icon: "/smartlogo.png",
        badge: "/smartlogo.png",
      },
      data: {
        alertPublicId: alert?.publicId || null,
        transactionPublicId: notification.metadata.transactionPublicId,
        receiptVerificationRef: notification.metadata.receiptVerificationRef,
        cashbackAmount: notification.metadata.cashbackAmount,
        cashbackStatus: notification.metadata.cashbackStatus,
        cashbackDestination: notification.metadata.cashbackDestination,
        reservationPublicId: notification.metadata.reservationPublicId,
        stationPublicId: notification.metadata.stationPublicId,
      },
    })
  } catch (error) {
    console.warn("Failed to send cashback push alert", error?.message || error)
  }

  return {
    alert,
    notification,
  }
}

function buildReceiptVerificationRef(transactionPublicId) {
  const token = String(transactionPublicId || createPublicId())
    .replace(/[^A-Z0-9]+/gi, "")
    .slice(-12)
    .toUpperCase()
  return `RCPT-${token || createPublicId().slice(-12)}`
}

async function resolveStationContextById(db, stationId) {
  const rows = await db.$queryRaw`
    SELECT id, public_id, name, city, address, timezone, prices_json
    FROM stations
    WHERE id = ${stationId}
    LIMIT 1
  `
  if (!rows?.[0]?.id) throw notFound("Station not found.")
  return rows[0]
}

async function resolveFuelType(db, code) {
  const fuelCode = normalizeFuelTypeCode(code)
  const rows = await db.$queryRaw`
    SELECT id, code
    FROM fuel_types
    WHERE code = ${fuelCode}
    LIMIT 1
  `
  if (!rows?.[0]?.id) throw notFound(`Fuel type not found: ${fuelCode}`)
  return rows[0]
}

async function listPromotionCampaignRows(db, stationId, fuelTypeCode) {
  return db.$queryRaw`
    SELECT
      pc.*,
      ft.code AS fuel_type_code
    FROM promotion_campaigns pc
    LEFT JOIN fuel_types ft ON ft.id = pc.fuel_type_id
    WHERE pc.station_id = ${stationId}
      AND pc.status <> 'ARCHIVED'
      AND (
        pc.fuel_type_id IS NULL
        OR ft.code = ${fuelTypeCode}
      )
    ORDER BY pc.starts_at ASC, pc.id ASC
  `
}

export async function previewPromotionAwarePricing(
  db,
  {
    stationId,
    fuelTypeCode,
    litres,
    paymentMethod = "CASH",
    userId = null,
    now = new Date(),
    cashbackDestination = "WALLET",
  }
) {
  const station = await resolveStationContextById(db, stationId)
  const fuelType = await resolveFuelType(db, fuelTypeCode)
  const basePricePerLitre = resolveFuelPricePerLitre(station.prices_json, fuelType.code)
  if (!Number.isFinite(basePricePerLitre) || basePricePerLitre <= 0) {
    throw badRequest(`Base pump price is unavailable for ${fuelType.code}.`)
  }

  const campaignRows = await listPromotionCampaignRows(db, station.id, fuelType.code)
  const pricing = calculateTransactionPricing({
    basePricePerLitre,
    litres,
    fuelTypeCode: fuelType.code,
    campaigns: campaignRows || [],
    paymentMethod,
    userId,
    now,
    cashbackDestination: normalizeCashbackDestination(cashbackDestination),
  })

  return {
    station,
    fuelType,
    pricing: buildPricingSnapshot(pricing),
  }
}

export function buildPricingSnapshot(pricing, overrides = {}) {
  return {
    basePricePerLitre: roundUnit(overrides.basePricePerLitre ?? pricing.basePricePerLitre),
    litres: roundLitres(overrides.litres ?? pricing.litres),
    subtotal: roundMoney(overrides.subtotal ?? pricing.subtotal),
    directPricePerLitre: roundUnit(overrides.directPricePerLitre ?? pricing.directPricePerLitre),
    stationDiscount: roundMoney(overrides.stationDiscount ?? pricing.stationDiscount),
    smartlinkDiscount: roundMoney(overrides.smartlinkDiscount ?? pricing.smartlinkDiscount),
    totalDirectDiscount: roundMoney(overrides.totalDirectDiscount ?? pricing.totalDirectDiscount),
    stationCashback: roundMoney(overrides.stationCashback ?? pricing.stationCashback),
    smartlinkCashback: roundMoney(overrides.smartlinkCashback ?? pricing.smartlinkCashback),
    cashback: roundMoney(overrides.cashback ?? pricing.cashback),
    finalPayable: roundMoney(overrides.finalPayable ?? pricing.finalPayable),
    effectiveNetCost: roundMoney(overrides.effectiveNetCost ?? pricing.effectiveNetCost),
    effectivePricePerLitre: roundUnit(overrides.effectivePricePerLitre ?? pricing.effectivePricePerLitre),
    promoLabelsApplied: Array.isArray(overrides.promoLabelsApplied ?? pricing.promoLabelsApplied)
      ? overrides.promoLabelsApplied ?? pricing.promoLabelsApplied
      : [],
    appliedCampaigns: Array.isArray(overrides.appliedCampaigns ?? pricing.appliedCampaigns)
      ? overrides.appliedCampaigns ?? pricing.appliedCampaigns
      : [],
    fingerprint: overrides.fingerprint || pricing.fingerprint,
    flags: overrides.flags || [],
  }
}

function applyLegacyAmountOverride(pricing, amount) {
  const finalPayable = roundMoney(amount)
  const effectiveNetCost = roundMoney(Math.max(0, finalPayable - Number(pricing.cashback || 0)))
  return buildPricingSnapshot(pricing, {
    finalPayable,
    directPricePerLitre: pricing.litres > 0 ? roundUnit(finalPayable / pricing.litres) : pricing.basePricePerLitre,
    effectiveNetCost,
    effectivePricePerLitre: pricing.litres > 0 ? roundUnit(effectiveNetCost / pricing.litres) : 0,
    flags: [...(Array.isArray(pricing.flags) ? pricing.flags : []), "MANUAL_AMOUNT_OVERRIDE"],
  })
}

export async function createPromotionAwareTransaction(
  db,
  {
    stationId,
    fuelTypeCode,
    litres,
    paymentMethod = "CASH",
    amount = null,
    userId = null,
    actorStaffId = null,
    actorUserId = null,
    pumpId = null,
    nozzleId = null,
    pumpSessionPublicId = null,
    pumpSessionReference = null,
    queueEntryId = null,
    reservationPublicId = null,
    note = null,
    occurredAt = new Date(),
    paymentReference = null,
    requestedLitres = null,
    cashbackDestination = "WALLET",
    allowLegacyAmountMismatch = false,
  }
) {
  const createdAt = new Date()
  const preview = await previewPromotionAwarePricing(db, {
    stationId,
    fuelTypeCode,
    litres,
    paymentMethod,
    userId,
    now: createdAt,
    cashbackDestination,
  })
  const station = preview.station
  const fuelType = preview.fuelType
  const stationTimezone = String(station?.timezone || "").trim() || getAppTimeZone()
  // Keep occurred_at and created_at identical to avoid timezone drift between
  // app-formatted timestamps and DB CURRENT_TIMESTAMP values.
  const persistedTransactionTime =
    formatDateTimeSqlInTimeZone(createdAt, stationTimezone)
    || formatDateTimeSqlInTimeZone(createdAt, getAppTimeZone())

  const normalizedAmount = Number.isFinite(Number(amount)) ? roundMoney(amount) : null
  let finalPricing = preview.pricing
  if (normalizedAmount !== null) {
    const mismatch = Math.abs(normalizedAmount - Number(finalPricing.finalPayable || 0))
    if (mismatch > 1 && finalPricing.appliedCampaigns.length > 0) {
      throw badRequest("Final amount does not match the eligible promotional pricing.")
    }
    if (mismatch > 1 && finalPricing.appliedCampaigns.length === 0 && allowLegacyAmountMismatch) {
      finalPricing = applyLegacyAmountOverride(finalPricing, normalizedAmount)
    } else if (mismatch <= 1) {
      finalPricing = buildPricingSnapshot(finalPricing, {
        finalPayable: normalizedAmount,
        directPricePerLitre:
          finalPricing.litres > 0 ? roundUnit(normalizedAmount / finalPricing.litres) : finalPricing.basePricePerLitre,
        effectiveNetCost: roundMoney(Math.max(0, normalizedAmount - Number(finalPricing.cashback || 0))),
        effectivePricePerLitre:
          finalPricing.litres > 0
            ? roundUnit(Math.max(0, normalizedAmount - Number(finalPricing.cashback || 0)) / finalPricing.litres)
            : 0,
      })
    } else if (mismatch > 1) {
      throw badRequest("Final amount does not match the current station pricing.")
    }
  }

  const txPublicId = createTransactionPublicIdValue({
    typeCode: "PAY",
    timestamp: createdAt,
  })
  const receiptVerificationRef = buildReceiptVerificationRef(txPublicId)
  const pricePerLitrePaid = finalPricing.litres > 0
    ? roundUnit(finalPricing.finalPayable / finalPricing.litres)
    : finalPricing.basePricePerLitre

  let cashbackStatus = finalPricing.cashback > 0 ? "EARNED" : "NONE"
  let cashbackCreditedAt = null
  let cashbackWalletTransaction = null
  const normalizedCashbackDestination = normalizeCashbackDestination(cashbackDestination)

  await db.$executeRaw`
    INSERT INTO transactions (
      station_id,
      public_id,
      pump_id,
      nozzle_id,
      user_id,
      reservation_public_id,
      fuel_type_id,
      occurred_at,
      created_at,
      litres,
      price_per_litre,
      base_price_per_litre,
      total_amount,
      subtotal,
      total_direct_discount,
      station_discount_total,
      smartlink_discount_total,
      cashback_total,
      final_amount_paid,
      effective_price_per_litre,
      promo_labels_applied,
      pricing_snapshot_json,
      receipt_verification_ref,
      cashback_status,
      cashback_destination,
      payment_method,
      recorded_by_staff_id,
      queue_entry_id,
      note,
      payment_reference,
      requested_litres
    )
    VALUES (
      ${station.id},
      ${txPublicId},
      ${pumpId},
      ${nozzleId},
      ${userId},
      ${reservationPublicId},
      ${fuelType.id},
      ${persistedTransactionTime},
      ${persistedTransactionTime},
      ${finalPricing.litres},
      ${pricePerLitrePaid},
      ${finalPricing.basePricePerLitre},
      ${finalPricing.finalPayable},
      ${finalPricing.subtotal},
      ${finalPricing.totalDirectDiscount},
      ${finalPricing.stationDiscount},
      ${finalPricing.smartlinkDiscount},
      ${finalPricing.cashback},
      ${finalPricing.finalPayable},
      ${finalPricing.effectivePricePerLitre},
      ${JSON.stringify(finalPricing.promoLabelsApplied)},
      ${JSON.stringify(finalPricing)},
      ${receiptVerificationRef},
      ${cashbackStatus},
      ${normalizedCashbackDestination},
      ${paymentMethod},
      ${actorStaffId},
      ${queueEntryId},
      ${note},
      ${paymentReference},
      ${requestedLitres}
    )
  `

  const transactionRows = await db.$queryRaw`
    SELECT id
    FROM transactions
    WHERE public_id = ${txPublicId}
    LIMIT 1
  `
  const transactionId = Number(transactionRows?.[0]?.id || 0)
  if (!Number.isFinite(transactionId) || transactionId <= 0) {
    throw badRequest("Transaction could not be created.")
  }

  const linkedPumpSession = await linkTransactionToPumpSession(db, {
    stationId: station.id,
    transactionId,
    pumpId,
    nozzleId,
    sessionPublicId: pumpSessionPublicId,
    sessionReference: pumpSessionReference,
    occurredAt:
      occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime())
        ? occurredAt
        : createdAt,
  })

  for (const campaign of finalPricing.appliedCampaigns) {
    await db.$executeRaw`
      INSERT INTO promotion_redemptions (
        public_id,
        transaction_id,
        campaign_id,
        user_id,
        litres_covered,
        direct_discount_amount,
        cashback_amount,
        station_funded_amount,
        smartlink_funded_amount,
        cashback_status,
        cashback_destination,
        snapshot_json
      )
      VALUES (
        ${createPublicId()},
        ${transactionId},
        ${campaign.campaignId},
        ${userId},
        ${campaign.litresCovered},
        ${campaign.directDiscountAmount},
        ${campaign.cashbackAmount},
        ${roundMoney(Number(campaign.directFunding?.stationAmount || 0) + Number(campaign.cashbackFunding?.stationAmount || 0))},
        ${roundMoney(Number(campaign.directFunding?.smartlinkAmount || 0) + Number(campaign.cashbackFunding?.smartlinkAmount || 0))},
        ${campaign.cashbackAmount > 0 ? cashbackStatus : "NONE"},
        ${campaign.cashbackAmount > 0 ? normalizedCashbackDestination : "NONE"},
        ${JSON.stringify(campaign)}
      )
    `
    await incrementPromotionRedemptionCounters(db, campaign.campaignId, campaign.litresCovered)
  }

  if (finalPricing.cashback > 0 && Number.isFinite(Number(userId || 0)) && Number(userId) > 0) {
    if (normalizedCashbackDestination === "WALLET") {
      const creditResult = await createWalletCashbackCredit(
        {
          userId,
          amount: finalPricing.cashback,
          actorUserId,
          transactionPublicId: txPublicId,
          relatedEntityType: "TRANSACTION",
          relatedEntityId: txPublicId,
          note: `SmartLink cashback for ${txPublicId}`,
          idempotencyKey: `wallet:cashback:${txPublicId}`,
          metadata: {
            stationPublicId: station.public_id,
            receiptVerificationRef,
            promoLabelsApplied: finalPricing.promoLabelsApplied,
          },
        },
        { tx: db }
      )
      cashbackWalletTransaction = creditResult?.transaction || null
      cashbackStatus = "CREDITED"
      cashbackCreditedAt = new Date()
    } else if (normalizedCashbackDestination === "LOYALTY") {
      cashbackStatus = "PENDING_LOYALTY"
    }
  }

  if (cashbackStatus !== "NONE") {
    await db.$executeRaw`
      UPDATE transactions
      SET
        cashback_status = ${cashbackStatus},
        cashback_credited_at = ${cashbackCreditedAt},
        pricing_snapshot_json = ${JSON.stringify({
          ...finalPricing,
          cashbackStatus,
          cashbackCreditedAt: toIsoOrNull(cashbackCreditedAt),
          cashbackWalletTransactionReference: cashbackWalletTransaction?.reference || null,
        })}
      WHERE id = ${transactionId}
    `

    await db.$executeRaw`
      UPDATE promotion_redemptions
      SET
        cashback_status = ${cashbackStatus},
        cashback_destination = ${normalizedCashbackDestination},
        cashback_credited_at = ${cashbackCreditedAt}
      WHERE transaction_id = ${transactionId}
        AND cashback_amount > 0
    `
  }

  const occurredAtLocal = persistedTransactionTime || toIsoOrNull(createdAt)

  return {
    transaction: {
      id: transactionId,
      publicId: txPublicId,
      stationPublicId: station.public_id,
      stationName: station.name,
      fuelTypeCode: fuelType.code,
      litres: finalPricing.litres,
      totalAmount: finalPricing.finalPayable,
      paymentMethod,
      paymentReference: String(paymentReference || "").trim() || null,
      occurredAt: occurredAtLocal,
      receiptVerificationRef,
      cashbackStatus,
      cashbackDestination: normalizedCashbackDestination,
      cashbackCreditedAt: toIsoOrNull(cashbackCreditedAt),
      cashbackWalletTransactionReference: cashbackWalletTransaction?.reference || null,
    },
    pumpSession: linkedPumpSession
      ? {
          publicId: linkedPumpSession.publicId,
          sessionReference: linkedPumpSession.sessionReference,
          status: linkedPumpSession.status,
          telemetryCorrelationId: linkedPumpSession.telemetryCorrelationId,
        }
      : null,
    pricing: {
      ...finalPricing,
      cashbackStatus,
      cashbackCreditedAt: toIsoOrNull(cashbackCreditedAt),
      cashbackWalletTransactionReference: cashbackWalletTransaction?.reference || null,
    },
  }
}

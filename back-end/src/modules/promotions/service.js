import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { zonedSqlDateTimeToUtcIso } from "../../utils/dateTime.js"
import { createPublicId, resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import {
  calculateTransactionPricing,
  normalizePromotionCampaign,
  resolvePromotionStatus,
} from "./pricing.engine.js"

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePriceAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value)
  const raw = String(value || "").trim()
  if (!raw) return null
  const normalized = raw.replace(/,/g, "")
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const amount = Number(match[1])
  return Number.isFinite(amount) ? amount : null
}

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

function normalizeFuelTypeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16)
}

function normalizeFundingSource(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["STATION", "SMARTLINK", "SHARED"].includes(normalized)) return normalized
  return "STATION"
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["DRAFT", "ACTIVE", "INACTIVE", "EXPIRED", "ARCHIVED"].includes(normalized)) return normalized
  return "DRAFT"
}

function normalizePromotionKind(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["DISCOUNT", "FLASH_PRICE", "CASHBACK"].includes(normalized)) return normalized
  return "DISCOUNT"
}

function normalizeDiscountMode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (
    ["PERCENTAGE_PER_LITRE", "FIXED_PER_LITRE", "FIXED_BASKET", "FLASH_PRICE_PER_LITRE"].includes(normalized)
  ) {
    return normalized
  }
  return null
}

function normalizeCashbackMode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["PERCENTAGE", "FIXED_AMOUNT"].includes(normalized)) return normalized
  return null
}

function normalizeCashbackDestination(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["WALLET", "LOYALTY", "NONE"].includes(normalized)) return normalized
  return "WALLET"
}

export function resolveFuelPricePerLitre(pricesJson, fuelType) {
  const normalizedFuelType = String(fuelType || "").trim().toUpperCase()
  if (!normalizedFuelType) return null

  const items = parseJsonArray(pricesJson)
  if (!items.length) return null

  const match = items.find((item) => {
    const label = String(item?.fuelType || item?.code || item?.label || item?.name || "")
      .trim()
      .toUpperCase()
    return (
      label === normalizedFuelType ||
      label.startsWith(`${normalizedFuelType} `) ||
      label.includes(normalizedFuelType)
    )
  })
  if (!match) return null

  const amount =
    parsePriceAmount(match?.pricePerLitre)
    ?? parsePriceAmount(match?.price_per_litre)
    ?? parsePriceAmount(match?.price)
    ?? parsePriceAmount(match?.amount)
    ?? parsePriceAmount(match?.value)

  if (!Number.isFinite(amount) || amount <= 0) return null
  return roundUnit(amount)
}

function normalizeEligibilityRules(rules = {}) {
  return {
    minLitres: toNumberOrNull(rules.minLitres),
    maxLitres: toNumberOrNull(rules.maxLitres),
    paymentMethods: Array.isArray(rules.paymentMethods)
      ? rules.paymentMethods.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
      : [],
    daysOfWeek: Array.isArray(rules.daysOfWeek)
      ? rules.daysOfWeek.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
      : [],
    startHour: String(rules.startHour || "").trim() || null,
    endHour: String(rules.endHour || "").trim() || null,
    requiresUser: rules.requiresUser === true,
    requiresSmartPay: rules.requiresSmartPay === true,
  }
}

function deriveFundingShares(payload) {
  const fundingSource = normalizeFundingSource(payload.fundingSource || payload.funding_source)
  const stationSharePct = toNumberOrNull(payload.stationSharePct ?? payload.station_share_pct)
  const smartlinkSharePct = toNumberOrNull(payload.smartlinkSharePct ?? payload.smartlink_share_pct)
  const total = Number((stationSharePct || 0) + (smartlinkSharePct || 0))

  if (Number.isFinite(total) && total > 0) {
    return {
      fundingSource,
      stationSharePct: Number((((stationSharePct || 0) / total) * 100).toFixed(4)),
      smartlinkSharePct: Number((((smartlinkSharePct || 0) / total) * 100).toFixed(4)),
    }
  }

  if (fundingSource === "SMARTLINK") {
    return { fundingSource, stationSharePct: 0, smartlinkSharePct: 100 }
  }
  if (fundingSource === "SHARED") {
    return { fundingSource, stationSharePct: 50, smartlinkSharePct: 50 }
  }
  return { fundingSource, stationSharePct: 100, smartlinkSharePct: 0 }
}

function assertPromotionPayload(payload) {
  const promotionKind = normalizePromotionKind(payload.promotionKind || payload.promotion_kind)
  const discountMode = normalizeDiscountMode(payload.discountMode || payload.discount_mode)
  const cashbackMode = normalizeCashbackMode(payload.cashbackMode || payload.cashback_mode)
  const discountValue = toNumberOrNull(payload.discountValue ?? payload.discount_value)
  const cashbackValue = toNumberOrNull(payload.cashbackValue ?? payload.cashback_value)
  const flashPricePerLitre = toNumberOrNull(payload.flashPricePerLitre ?? payload.flash_price_per_litre)
  const startsAt = payload.startsAt || payload.starts_at
  const endsAt = payload.endsAt || payload.ends_at

  if (!String(payload.name || "").trim()) {
    throw badRequest("Campaign name is required.")
  }
  if (!startsAt || !endsAt) {
    throw badRequest("Campaign start and end times are required.")
  }
  if (new Date(startsAt) >= new Date(endsAt)) {
    throw badRequest("Campaign end time must be after the start time.")
  }
  if (!discountMode && !cashbackMode && !Number.isFinite(flashPricePerLitre)) {
    throw badRequest("Campaign must define a discount, flash price, or cashback.")
  }
  if (discountMode && (!Number.isFinite(discountValue) || discountValue <= 0) && discountMode !== "FLASH_PRICE_PER_LITRE") {
    throw badRequest("Discount value must be greater than zero.")
  }
  if (cashbackMode && (!Number.isFinite(cashbackValue) || cashbackValue <= 0)) {
    throw badRequest("Cashback value must be greater than zero.")
  }
  if (promotionKind === "FLASH_PRICE" && (!Number.isFinite(flashPricePerLitre) || flashPricePerLitre <= 0)) {
    throw badRequest("Flash fuel price campaigns require a flash price per litre.")
  }

  return {
    promotionKind,
    discountMode,
    discountValue,
    cashbackMode,
    cashbackValue,
    flashPricePerLitre,
  }
}

function mapCampaignRow(row, { timeZone = null } = {}) {
  const mapped = normalizePromotionCampaign({
    ...row,
    startsAt:
      zonedSqlDateTimeToUtcIso(row?.starts_at_local || row?.starts_at, timeZone || undefined)
      || row?.starts_at,
    endsAt:
      zonedSqlDateTimeToUtcIso(row?.ends_at_local || row?.ends_at, timeZone || undefined)
      || row?.ends_at,
  })
  return {
    ...mapped,
    startsAt: toIsoOrNull(mapped.startsAt),
    endsAt: toIsoOrNull(mapped.endsAt),
    status: resolvePromotionStatus(mapped, new Date()),
    cashbackDestination: normalizeCashbackDestination(row?.cashback_destination),
    createdAt: toIsoOrNull(row?.created_at),
    updatedAt: toIsoOrNull(row?.updated_at),
    createdByUserId: Number(row?.created_by_user_id || 0) || null,
  }
}

export async function resolvePromotionStationContext(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, address, timezone, prices_json
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  return rows?.[0] || { ...station, prices_json: null, timezone: "Africa/Blantyre" }
}

async function resolveFuelTypeIdByCode(code) {
  const fuelCode = normalizeFuelTypeCode(code)
  if (!fuelCode) return null
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM fuel_types
    WHERE code = ${fuelCode}
    LIMIT 1
  `
  return Number(rows?.[0]?.id || 0) || null
}

async function assertNoFlashOverlap({
  stationId,
  fuelTypeId,
  startsAt,
  endsAt,
  ignorePublicId = null,
}) {
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM promotion_campaigns
    WHERE station_id = ${stationId}
      AND promotion_kind = 'FLASH_PRICE'
      AND status IN ('ACTIVE', 'DRAFT', 'INACTIVE')
      AND is_active = 1
      AND fuel_type_id <=> ${fuelTypeId}
      AND (${ignorePublicId} IS NULL OR public_id <> ${ignorePublicId})
      AND starts_at < ${endsAt}
      AND ends_at > ${startsAt}
    LIMIT 1
  `
  if (rows?.[0]?.public_id) {
    throw badRequest("An overlapping flash fuel price already exists for this station and fuel type.")
  }
}

export async function listStationPromotionCampaigns(stationPublicId) {
  const station = await resolvePromotionStationContext(stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT
      pc.*,
      ft.code AS fuel_type_code,
      DATE_FORMAT(pc.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at_local,
      DATE_FORMAT(pc.ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at_local
    FROM promotion_campaigns pc
    LEFT JOIN fuel_types ft ON ft.id = pc.fuel_type_id
    WHERE pc.station_id = ${station.id}
    ORDER BY pc.starts_at DESC, pc.id DESC
  `

  const items = (rows || []).map((row) => mapCampaignRow(row, { timeZone: station.timezone }))
  const now = new Date()

  return {
    station: {
      publicId: station.public_id,
      name: station.name,
      city: station.city || null,
    },
    items,
    summary: {
      total: items.length,
      active: items.filter((item) => resolvePromotionStatus(item, now) === "ACTIVE").length,
      scheduled: items.filter((item) => resolvePromotionStatus(item, now) === "SCHEDULED").length,
      expired: items.filter((item) => resolvePromotionStatus(item, now) === "EXPIRED").length,
      inactive: items.filter((item) => ["INACTIVE", "ARCHIVED", "DRAFT"].includes(resolvePromotionStatus(item, now))).length,
    },
  }
}

export async function createPromotionCampaign(stationPublicId, payload, auth = {}) {
  const station = await resolvePromotionStationContext(stationPublicId)
  const actorUserId = Number(auth?.userId || 0) || null
  const normalized = assertPromotionPayload(payload)
  const fuelTypeId = await resolveFuelTypeIdByCode(payload.fuelTypeCode || payload.fuelType || payload.fuel_type_code)
  const funding = deriveFundingShares(payload)

  if (normalized.promotionKind === "FLASH_PRICE") {
    await assertNoFlashOverlap({
      stationId: station.id,
      fuelTypeId,
      startsAt: new Date(payload.startsAt || payload.starts_at),
      endsAt: new Date(payload.endsAt || payload.ends_at),
    })
  }

  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO promotion_campaigns (
      public_id,
      station_id,
      name,
      description,
      campaign_label,
      promotion_kind,
      fuel_type_id,
      funding_source,
      station_share_pct,
      smartlink_share_pct,
      discount_mode,
      discount_value,
      cashback_mode,
      cashback_value,
      cashback_destination,
      flash_price_per_litre,
      starts_at,
      ends_at,
      is_active,
      status,
      max_redemptions,
      max_litres,
      redeemed_count,
      redeemed_litres,
      eligibility_rules_json,
      created_by_user_id
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${String(payload.name || "").trim()},
      ${String(payload.description || "").trim() || null},
      ${String(payload.campaignLabel || payload.campaign_label || payload.name || "").trim()},
      ${normalized.promotionKind},
      ${fuelTypeId},
      ${funding.fundingSource},
      ${funding.stationSharePct},
      ${funding.smartlinkSharePct},
      ${normalized.discountMode},
      ${normalized.discountValue},
      ${normalized.cashbackMode},
      ${normalized.cashbackValue},
      ${normalizeCashbackDestination(payload.cashbackDestination || payload.cashback_destination)},
      ${normalized.flashPricePerLitre},
      ${new Date(payload.startsAt || payload.starts_at)},
      ${new Date(payload.endsAt || payload.ends_at)},
      ${payload.isActive !== false},
      ${normalizeStatus(payload.status || (payload.isActive === false ? "INACTIVE" : "ACTIVE"))},
      ${toNumberOrNull(payload.maxRedemptions ?? payload.max_redemptions)},
      ${toNumberOrNull(payload.maxLitres ?? payload.max_litres)},
      0,
      0,
      ${JSON.stringify(normalizeEligibilityRules(payload.eligibilityRules || payload.eligibility_rules || {}))},
      ${actorUserId}
    )
  `

  await writeAuditLog({
    stationId: station.id,
    actorStaffId: null,
    actionType: "PROMOTION_CREATE",
    payload: {
      campaignPublicId: publicId,
      name: payload.name,
      promotionKind: normalized.promotionKind,
      fuelTypeCode: payload.fuelTypeCode || payload.fuelType || null,
    },
  })

  return getPromotionCampaignByPublicId(station.id, publicId, { timeZone: station.timezone })
}

export async function getPromotionCampaignByPublicId(stationId, campaignPublicId, { timeZone = null } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT
      pc.*,
      ft.code AS fuel_type_code,
      DATE_FORMAT(pc.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at_local,
      DATE_FORMAT(pc.ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at_local
    FROM promotion_campaigns pc
    LEFT JOIN fuel_types ft ON ft.id = pc.fuel_type_id
    WHERE pc.station_id = ${stationId}
      AND pc.public_id = ${campaignPublicId}
    LIMIT 1
  `
  if (!rows?.[0]) throw notFound("Promotion campaign not found.")
  return mapCampaignRow(rows[0], { timeZone })
}

export async function updatePromotionCampaign(stationPublicId, campaignPublicId, payload) {
  const station = await resolvePromotionStationContext(stationPublicId)
  const existing = await getPromotionCampaignByPublicId(station.id, campaignPublicId, {
    timeZone: station.timezone,
  })
  const merged = {
    ...existing,
    ...payload,
    fuelTypeCode: payload.fuelTypeCode || payload.fuelType || payload.fuel_type_code || existing.fuelTypeCode,
    startsAt: payload.startsAt || payload.starts_at || existing.startsAt,
    endsAt: payload.endsAt || payload.ends_at || existing.endsAt,
    campaignLabel: payload.campaignLabel || payload.campaign_label || existing.campaignLabel,
  }
  const normalized = assertPromotionPayload(merged)
  const fuelTypeId = await resolveFuelTypeIdByCode(merged.fuelTypeCode)
  const funding = deriveFundingShares(merged)

  if (normalized.promotionKind === "FLASH_PRICE") {
    await assertNoFlashOverlap({
      stationId: station.id,
      fuelTypeId,
      startsAt: new Date(merged.startsAt),
      endsAt: new Date(merged.endsAt),
      ignorePublicId: campaignPublicId,
    })
  }

  await prisma.$executeRaw`
    UPDATE promotion_campaigns
    SET
      name = ${String(merged.name || "").trim()},
      description = ${String(merged.description || "").trim() || null},
      campaign_label = ${String(merged.campaignLabel || merged.name || "").trim()},
      promotion_kind = ${normalized.promotionKind},
      fuel_type_id = ${fuelTypeId},
      funding_source = ${funding.fundingSource},
      station_share_pct = ${funding.stationSharePct},
      smartlink_share_pct = ${funding.smartlinkSharePct},
      discount_mode = ${normalized.discountMode},
      discount_value = ${normalized.discountValue},
      cashback_mode = ${normalized.cashbackMode},
      cashback_value = ${normalized.cashbackValue},
      cashback_destination = ${normalizeCashbackDestination(
        merged.cashbackDestination || merged.cashback_destination || existing.cashbackDestination
      )},
      flash_price_per_litre = ${normalized.flashPricePerLitre},
      starts_at = ${new Date(merged.startsAt)},
      ends_at = ${new Date(merged.endsAt)},
      is_active = ${merged.isActive !== false},
      status = ${normalizeStatus(merged.status || existing.status)},
      max_redemptions = ${toNumberOrNull(merged.maxRedemptions ?? merged.max_redemptions)},
      max_litres = ${toNumberOrNull(merged.maxLitres ?? merged.max_litres)},
      eligibility_rules_json = ${JSON.stringify(
        normalizeEligibilityRules(merged.eligibilityRules || merged.eligibility_rules || existing.eligibilityRules)
      )},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE station_id = ${station.id}
      AND public_id = ${campaignPublicId}
  `

  await writeAuditLog({
    stationId: station.id,
    actionType: "PROMOTION_UPDATE",
    payload: {
      campaignPublicId,
      name: merged.name,
      promotionKind: normalized.promotionKind,
    },
  })

  return getPromotionCampaignByPublicId(station.id, campaignPublicId, { timeZone: station.timezone })
}

export async function setPromotionCampaignActiveState(stationPublicId, campaignPublicId, isActive) {
  const station = await resolvePromotionStationContext(stationPublicId)
  const existing = await getPromotionCampaignByPublicId(station.id, campaignPublicId, {
    timeZone: station.timezone,
  })
  const nextStatus = isActive ? "ACTIVE" : "INACTIVE"

  await prisma.$executeRaw`
    UPDATE promotion_campaigns
    SET
      is_active = ${Boolean(isActive)},
      status = ${nextStatus},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE station_id = ${station.id}
      AND public_id = ${campaignPublicId}
  `

  await writeAuditLog({
    stationId: station.id,
    actionType: isActive ? "PROMOTION_ACTIVATE" : "PROMOTION_DEACTIVATE",
    payload: {
      campaignPublicId,
      previousStatus: existing.status,
      nextStatus,
    },
  })

  return getPromotionCampaignByPublicId(station.id, campaignPublicId, { timeZone: station.timezone })
}

export async function archivePromotionCampaign(stationPublicId, campaignPublicId) {
  const station = await resolvePromotionStationContext(stationPublicId)
  await getPromotionCampaignByPublicId(station.id, campaignPublicId, { timeZone: station.timezone })

  await prisma.$executeRaw`
    UPDATE promotion_campaigns
    SET
      is_active = 0,
      status = 'ARCHIVED',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE station_id = ${station.id}
      AND public_id = ${campaignPublicId}
  `

  await writeAuditLog({
    stationId: station.id,
    actionType: "PROMOTION_ARCHIVE",
    payload: { campaignPublicId },
  })

  return {
    archived: true,
    campaignPublicId,
  }
}

export async function getPromotionPricingPreview({
  stationPublicId,
  fuelTypeCode,
  litres,
  paymentMethod = "CASH",
  userId = null,
  now = new Date(),
  cashbackDestination = "WALLET",
}) {
  const station = await resolvePromotionStationContext(stationPublicId)
  const normalizedFuelTypeCode = normalizeFuelTypeCode(fuelTypeCode)
  const basePricePerLitre = resolveFuelPricePerLitre(station.prices_json, normalizedFuelTypeCode)
  if (!Number.isFinite(basePricePerLitre) || basePricePerLitre <= 0) {
    throw badRequest(`Base pump price is unavailable for ${normalizedFuelTypeCode || "the selected fuel type"}.`)
  }

  const rows = await prisma.$queryRaw`
    SELECT
      pc.*,
      ft.code AS fuel_type_code,
      DATE_FORMAT(pc.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at_local,
      DATE_FORMAT(pc.ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at_local
    FROM promotion_campaigns pc
    LEFT JOIN fuel_types ft ON ft.id = pc.fuel_type_id
    WHERE pc.station_id = ${station.id}
      AND pc.status <> 'ARCHIVED'
      AND (
        pc.fuel_type_id IS NULL
        OR ft.code = ${normalizedFuelTypeCode}
      )
    ORDER BY pc.starts_at ASC, pc.id ASC
  `
  const campaigns = (rows || []).map((row) => mapCampaignRow(row, { timeZone: station.timezone }))
  const pricing = calculateTransactionPricing({
    basePricePerLitre,
    litres,
    fuelTypeCode: normalizedFuelTypeCode,
    campaigns,
    paymentMethod,
    userId,
    now,
    cashbackDestination,
  })

  return {
    station: {
      publicId: station.public_id,
      name: station.name,
      city: station.city || null,
      address: station.address || null,
      timezone: station.timezone || "Africa/Blantyre",
    },
    fuelTypeCode: normalizedFuelTypeCode,
    basePricePerLitre,
    pricing,
  }
}

export async function listUserFacingPromotionsPreview({
  stationPublicId,
  fuelTypeCode,
  litres = 20,
  paymentMethod = "CASH",
  userId = null,
  now = new Date(),
}) {
  const preview = await getPromotionPricingPreview({
    stationPublicId,
    fuelTypeCode,
    litres,
    paymentMethod,
    userId,
    now,
    cashbackDestination: "WALLET",
  })

  const offers = preview.pricing.eligibility
    .filter((item) => item.isEligible)
    .map((item) => {
      const applied = preview.pricing.appliedCampaigns.find(
        (campaign) =>
          campaign.campaignId === item.campaignId || campaign.campaignPublicId === item.campaignPublicId
      )
      return {
        campaignPublicId: item.campaignPublicId,
        campaignLabel: item.campaignLabel,
        directDiscountAmount: roundMoney(applied?.directDiscountAmount || 0),
        cashbackAmount: roundMoney(applied?.cashbackAmount || 0),
        countdownEndsAt: applied?.endsAt || null,
      }
    })

  return {
    ...preview,
    offers,
  }
}

export async function incrementPromotionRedemptionCounters(tx, campaignId, litresCovered) {
  if (!Number.isFinite(Number(campaignId || 0)) || Number(campaignId) <= 0) return
  await tx.$executeRaw`
    UPDATE promotion_campaigns
    SET
      redeemed_count = redeemed_count + 1,
      redeemed_litres = redeemed_litres + ${roundMoney(litresCovered || 0)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${campaignId}
  `
}

import crypto from "node:crypto"

const ACTIVE_CAMPAIGN_STATUSES = new Set(["ACTIVE"])
const DIRECT_DISCOUNT_MODES = new Set([
  "PERCENTAGE_PER_LITRE",
  "FIXED_PER_LITRE",
  "FIXED_BASKET",
  "FLASH_PRICE_PER_LITRE",
])
const CASHBACK_MODES = new Set(["PERCENTAGE", "FIXED_AMOUNT"])
const DAYS_OF_WEEK = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]

function roundMoney(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function roundUnitPrice(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(4))
}

function roundLitres(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(3))
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toDateOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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

function normalizeArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeFundingShares(campaign) {
  const fundingSource = String(campaign?.fundingSource || campaign?.funding_source || "STATION")
    .trim()
    .toUpperCase()
  const stationShare = toNumberOrNull(campaign?.stationSharePct ?? campaign?.station_share_pct)
  const smartlinkShare = toNumberOrNull(campaign?.smartlinkSharePct ?? campaign?.smartlink_share_pct)
  const total = Number((stationShare || 0) + (smartlinkShare || 0))

  if (Number.isFinite(total) && total > 0) {
    return {
      fundingSource,
      stationSharePct: Number((((stationShare || 0) / total) * 100).toFixed(4)),
      smartlinkSharePct: Number((((smartlinkShare || 0) / total) * 100).toFixed(4)),
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

function splitFundingAmount(totalAmount, campaign) {
  const normalizedAmount = roundMoney(totalAmount)
  if (normalizedAmount <= 0) {
    return {
      stationAmount: 0,
      smartlinkAmount: 0,
    }
  }

  const shares = normalizeFundingShares(campaign)
  const stationAmount = roundMoney((normalizedAmount * shares.stationSharePct) / 100)
  const smartlinkAmount = roundMoney(normalizedAmount - stationAmount)
  return {
    stationAmount,
    smartlinkAmount,
  }
}

function normalizeEligibilityRules(value) {
  const rules = value && typeof value === "object" && !Array.isArray(value) ? value : parseJsonObject(value)
  return {
    minLitres: toNumberOrNull(rules.minLitres),
    maxLitres: toNumberOrNull(rules.maxLitres),
    paymentMethods: normalizeArray(rules.paymentMethods)
      .map((item) => String(item || "").trim().toUpperCase())
      .filter(Boolean),
    daysOfWeek: normalizeArray(rules.daysOfWeek)
      .map((item) => String(item || "").trim().toUpperCase())
      .filter((item) => DAYS_OF_WEEK.includes(item)),
    startHour: String(rules.startHour || "").trim() || null,
    endHour: String(rules.endHour || "").trim() || null,
    requiresUser: rules.requiresUser === true,
    requiresSmartPay: rules.requiresSmartPay === true,
  }
}

export function normalizePromotionCampaign(rawCampaign = {}) {
  const discountMode = String(rawCampaign?.discountMode || rawCampaign?.discount_mode || "")
    .trim()
    .toUpperCase()
  const cashbackMode = String(rawCampaign?.cashbackMode || rawCampaign?.cashback_mode || "")
    .trim()
    .toUpperCase()
  const flashPricePerLitre = toNumberOrNull(rawCampaign?.flashPricePerLitre ?? rawCampaign?.flash_price_per_litre)

  return {
    id: Number(rawCampaign?.id || 0) || null,
    publicId: String(rawCampaign?.publicId || rawCampaign?.public_id || "").trim() || null,
    stationId: Number(rawCampaign?.stationId || rawCampaign?.station_id || 0) || null,
    stationPublicId: String(rawCampaign?.stationPublicId || rawCampaign?.station_public_id || "").trim() || null,
    fuelTypeCode: String(rawCampaign?.fuelTypeCode || rawCampaign?.fuel_type_code || rawCampaign?.fuelType || "")
      .trim()
      .toUpperCase() || null,
    fuelTypeId: Number(rawCampaign?.fuelTypeId || rawCampaign?.fuel_type_id || 0) || null,
    name: String(rawCampaign?.name || "").trim() || "Campaign",
    description: String(rawCampaign?.description || "").trim() || null,
    campaignLabel: String(rawCampaign?.campaignLabel || rawCampaign?.campaign_label || "").trim() || null,
    promotionKind: String(rawCampaign?.promotionKind || rawCampaign?.promotion_kind || "DISCOUNT")
      .trim()
      .toUpperCase(),
    fundingSource: normalizeFundingShares(rawCampaign).fundingSource,
    stationSharePct: normalizeFundingShares(rawCampaign).stationSharePct,
    smartlinkSharePct: normalizeFundingShares(rawCampaign).smartlinkSharePct,
    discountMode: DIRECT_DISCOUNT_MODES.has(discountMode) ? discountMode : null,
    discountValue: toNumberOrNull(rawCampaign?.discountValue ?? rawCampaign?.discount_value),
    cashbackMode: CASHBACK_MODES.has(cashbackMode) ? cashbackMode : null,
    cashbackValue: toNumberOrNull(rawCampaign?.cashbackValue ?? rawCampaign?.cashback_value),
    flashPricePerLitre: Number.isFinite(flashPricePerLitre) ? roundUnitPrice(flashPricePerLitre) : null,
    startsAt: toDateOrNull(rawCampaign?.startsAt || rawCampaign?.starts_at),
    endsAt: toDateOrNull(rawCampaign?.endsAt || rawCampaign?.ends_at),
    isActive: Boolean(rawCampaign?.isActive ?? rawCampaign?.is_active),
    status: String(rawCampaign?.status || "DRAFT").trim().toUpperCase(),
    maxRedemptions: toNumberOrNull(rawCampaign?.maxRedemptions ?? rawCampaign?.max_redemptions),
    maxLitres: toNumberOrNull(rawCampaign?.maxLitres ?? rawCampaign?.max_litres),
    redeemedCount: toNumberOrNull(rawCampaign?.redeemedCount ?? rawCampaign?.redeemed_count) || 0,
    redeemedLitres: toNumberOrNull(rawCampaign?.redeemedLitres ?? rawCampaign?.redeemed_litres) || 0,
    eligibilityRules: normalizeEligibilityRules(
      rawCampaign?.eligibilityRules || rawCampaign?.eligibility_rules_json
    ),
  }
}

export function resolvePromotionStatus(campaign, now = new Date()) {
  const startsAt = toDateOrNull(campaign?.startsAt)
  const endsAt = toDateOrNull(campaign?.endsAt)
  const current = toDateOrNull(now) || new Date()
  const explicitStatus = String(campaign?.status || "").trim().toUpperCase()

  if (explicitStatus === "ARCHIVED") return "ARCHIVED"
  if (!campaign?.isActive || explicitStatus === "INACTIVE") return "INACTIVE"
  if (endsAt && current > endsAt) return "EXPIRED"
  if (startsAt && current < startsAt) return "SCHEDULED"
  if (ACTIVE_CAMPAIGN_STATUSES.has(explicitStatus) || explicitStatus === "SCHEDULED") return "ACTIVE"
  return "DRAFT"
}

function resolveCampaignCoverageLitres(campaign, litres) {
  const requestedLitres = roundLitres(litres)
  const maxLitres = toNumberOrNull(campaign?.maxLitres)
  const redeemedLitres = toNumberOrNull(campaign?.redeemedLitres) || 0
  if (campaign?.promotionKind === "CASHBACK" || !Number.isFinite(maxLitres) || maxLitres <= 0) return requestedLitres
  const remaining = roundLitres(maxLitres - redeemedLitres)
  if (remaining <= 0) return 0
  return Math.min(requestedLitres, remaining)
}

function isWithinDayWindow(campaign, now) {
  const days = Array.isArray(campaign?.eligibilityRules?.daysOfWeek)
    ? campaign.eligibilityRules.daysOfWeek
    : []
  if (!days.length) return true
  return days.includes(DAYS_OF_WEEK[now.getDay()])
}

function parseClockMinutes(clockValue) {
  const text = String(clockValue || "").trim()
  const match = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function isWithinHourWindow(campaign, now) {
  const startMinutes = parseClockMinutes(campaign?.eligibilityRules?.startHour)
  const endMinutes = parseClockMinutes(campaign?.eligibilityRules?.endHour)
  if (startMinutes === null && endMinutes === null) return true

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  if (startMinutes !== null && endMinutes !== null) {
    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes <= endMinutes
    }
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes
  }
  if (startMinutes !== null) return nowMinutes >= startMinutes
  return nowMinutes <= endMinutes
}

export function evaluateCampaignEligibility(rawCampaign, context = {}) {
  const campaign = normalizePromotionCampaign(rawCampaign)
  const now = toDateOrNull(context?.now) || new Date()
  const reasons = []

  if (resolvePromotionStatus(campaign, now) !== "ACTIVE") {
    reasons.push("Campaign is not active.")
  }

  const paymentMethod = String(context?.paymentMethod || "").trim().toUpperCase()
  const fuelTypeCode = String(context?.fuelTypeCode || "").trim().toUpperCase()
  const litres = roundLitres(context?.litres)
  const hasUser = Number.isFinite(Number(context?.userId || 0)) && Number(context?.userId) > 0

  if (campaign.fuelTypeCode && fuelTypeCode && campaign.fuelTypeCode !== fuelTypeCode) {
    reasons.push("Campaign does not match the selected fuel type.")
  }

  const startsAt = toDateOrNull(campaign.startsAt)
  const endsAt = toDateOrNull(campaign.endsAt)
  if (startsAt && now < startsAt) {
    reasons.push("Campaign has not started.")
  }
  if (endsAt && now > endsAt) {
    reasons.push("Campaign has expired.")
  }

  if (
    campaign.promotionKind !== "CASHBACK" &&
    Number.isFinite(campaign.maxRedemptions) &&
    campaign.maxRedemptions > 0 &&
    Number(campaign.redeemedCount || 0) >= campaign.maxRedemptions
  ) {
    reasons.push("Campaign has reached the maximum redemptions.")
  }

  const coverageLitres = resolveCampaignCoverageLitres(campaign, litres)
  if (litres <= 0) {
    reasons.push("Transaction litres must be greater than zero.")
  }
  if (coverageLitres <= 0) {
    reasons.push("Campaign has no remaining litre coverage.")
  }

  const minLitres = toNumberOrNull(campaign?.eligibilityRules?.minLitres)
  if (Number.isFinite(minLitres) && litres < minLitres) {
    reasons.push(`Campaign requires at least ${minLitres}L.`)
  }

  const maxLitres = toNumberOrNull(campaign?.eligibilityRules?.maxLitres)
  if (Number.isFinite(maxLitres) && litres > maxLitres) {
    reasons.push(`Campaign allows up to ${maxLitres}L.`)
  }

  const paymentMethods = Array.isArray(campaign?.eligibilityRules?.paymentMethods)
    ? campaign.eligibilityRules.paymentMethods
    : []
  if (paymentMethods.length && (!paymentMethod || !paymentMethods.includes(paymentMethod))) {
    // Allow SMARTPAY if CASH is allowed (for prepaid wallet transactions)
    const isEligible = paymentMethods.includes(paymentMethod) ||
      (paymentMethod === "SMARTPAY" && paymentMethods.includes("CASH"))
    if (!isEligible) {
      reasons.push("Campaign is not eligible for the selected payment method.")
    }
  }

  if (campaign?.eligibilityRules?.requiresUser && !hasUser) {
    reasons.push("Campaign requires an identified user.")
  }

  if (campaign?.eligibilityRules?.requiresSmartPay && paymentMethod !== "SMARTPAY") {
    reasons.push("Campaign requires SmartPay.")
  }

  if (!isWithinDayWindow(campaign, now)) {
    reasons.push("Campaign is not available on this day.")
  }

  if (!isWithinHourWindow(campaign, now)) {
    reasons.push("Campaign is outside the eligibility time window.")
  }

  return {
    campaign,
    isEligible: reasons.length === 0,
    reasons,
    coverageLitres,
  }
}

function computeDirectDiscountAmount(campaign, { basePricePerLitre, litres, subtotal }) {
  const coverageLitres = resolveCampaignCoverageLitres(campaign, litres)
  if (coverageLitres <= 0) return 0

  if (campaign.discountMode === "PERCENTAGE_PER_LITRE") {
    return roundMoney((basePricePerLitre * coverageLitres * Number(campaign.discountValue || 0)) / 100)
  }
  if (campaign.discountMode === "FIXED_PER_LITRE") {
    return roundMoney(Number(campaign.discountValue || 0) * coverageLitres)
  }
  if (campaign.discountMode === "FIXED_BASKET") {
    if (coverageLitres < roundLitres(litres)) return 0
    return roundMoney(Number(campaign.discountValue || 0))
  }
  if (campaign.discountMode === "FLASH_PRICE_PER_LITRE") {
    const flashPrice = Number(campaign.flashPricePerLitre || 0)
    if (!Number.isFinite(flashPrice) || flashPrice <= 0 || flashPrice >= basePricePerLitre) return 0
    return roundMoney((basePricePerLitre - flashPrice) * coverageLitres)
  }

  return 0
}

function computeCashbackAmount(campaign, { cashbackBaseAmount, litres }) {
  const coverageLitres = resolveCampaignCoverageLitres(campaign, litres)
  if (coverageLitres <= 0) return 0
  const coverageRatio = litres > 0 ? coverageLitres / litres : 0

  if (campaign.cashbackMode === "PERCENTAGE") {
    return roundMoney((cashbackBaseAmount * Number(campaign.cashbackValue || 0)) / 100)
  }
  if (campaign.cashbackMode === "FIXED_AMOUNT") {
    return roundMoney(Number(campaign.cashbackValue || 0) * coverageRatio)
  }
  return 0
}

function normalizeCampaignApplication(campaign, directDiscountAmount, cashbackAmount, litresCovered, cashbackDestination) {
  const directFunding = splitFundingAmount(directDiscountAmount, campaign)
  const cashbackFunding = splitFundingAmount(cashbackAmount, campaign)

  return {
    campaignId: campaign.id,
    campaignPublicId: campaign.publicId,
    name: campaign.name,
    campaignLabel: campaign.campaignLabel || campaign.name,
    promotionKind: campaign.promotionKind,
    fundingSource: campaign.fundingSource,
    discountMode: campaign.discountMode,
    discountValue: campaign.discountValue,
    cashbackMode: campaign.cashbackMode,
    cashbackValue: campaign.cashbackValue,
    flashPricePerLitre: campaign.flashPricePerLitre,
    litresCovered: roundLitres(litresCovered),
    directDiscountAmount: roundMoney(directDiscountAmount),
    cashbackAmount: roundMoney(cashbackAmount),
    directFunding,
    cashbackFunding,
    cashbackDestination,
    startsAt: campaign.startsAt ? campaign.startsAt.toISOString() : null,
    endsAt: campaign.endsAt ? campaign.endsAt.toISOString() : null,
    status: campaign.status,
  }
}

export function calculateTransactionPricing({
  basePricePerLitre,
  litres,
  campaigns = [],
  fuelTypeCode = "",
  paymentMethod = "",
  userId = null,
  now = new Date(),
  cashbackDestination = "WALLET",
} = {}) {
  const normalizedBasePricePerLitre = roundUnitPrice(basePricePerLitre)
  const normalizedLitres = roundLitres(litres)
  const subtotal = roundMoney(normalizedBasePricePerLitre * normalizedLitres)
  const eligibleResults = (campaigns || []).map((campaign) =>
    evaluateCampaignEligibility(campaign, {
      fuelTypeCode,
      litres: normalizedLitres,
      paymentMethod,
      userId,
      now,
    })
  )

  const eligibleCampaigns = eligibleResults.filter((result) => result.isEligible).map((result) => result.campaign)
  const directCandidates = eligibleCampaigns
    .map((campaign) => {
      const directDiscountAmount = computeDirectDiscountAmount(campaign, {
        basePricePerLitre: normalizedBasePricePerLitre,
        litres: normalizedLitres,
        subtotal,
      })
      return {
        campaign,
        directDiscountAmount,
      }
    })
    .filter((item) => item.directDiscountAmount > 0)
    .sort((left, right) => {
      if (right.directDiscountAmount !== left.directDiscountAmount) {
        return right.directDiscountAmount - left.directDiscountAmount
      }
      const leftKind = String(left.campaign?.promotionKind || "")
      const rightKind = String(right.campaign?.promotionKind || "")
      if (leftKind === rightKind) return 0
      if (rightKind === "FLASH_PRICE") return 1
      if (leftKind === "FLASH_PRICE") return -1
      return 0
    })

  const appliedCampaigns = []
  let totalDirectDiscount = 0

  if (directCandidates[0]?.campaign) {
    totalDirectDiscount = Math.min(subtotal, roundMoney(directCandidates[0].directDiscountAmount))
    const directCampaign = directCandidates[0].campaign
    appliedCampaigns.push(
      normalizeCampaignApplication(
        directCampaign,
        totalDirectDiscount,
        0,
        resolveCampaignCoverageLitres(directCampaign, normalizedLitres),
        cashbackDestination
      )
    )
  }

  const finalPayableBeforeCashback = Math.max(0, roundMoney(subtotal - totalDirectDiscount))
  let totalCashback = 0

  for (const campaign of eligibleCampaigns) {
    const alreadyApplied = appliedCampaigns.some(
      (item) => item.campaignId === campaign.id || item.campaignPublicId === campaign.publicId
    )
    const candidateDirect = computeDirectDiscountAmount(campaign, {
      basePricePerLitre: normalizedBasePricePerLitre,
      litres: normalizedLitres,
      subtotal,
    })
    if (alreadyApplied === false && candidateDirect > 0) {
      continue
    }

    const cashbackAmount = computeCashbackAmount(campaign, {
      cashbackBaseAmount: finalPayableBeforeCashback,
      litres: normalizedLitres,
    })
    if (cashbackAmount <= 0) continue

    const cappedCashback = Math.max(0, Math.min(finalPayableBeforeCashback - totalCashback, cashbackAmount))
    if (cappedCashback <= 0) continue

    const existingIndex = appliedCampaigns.findIndex(
      (item) => item.campaignId === campaign.id || item.campaignPublicId === campaign.publicId
    )
    if (existingIndex >= 0) {
      appliedCampaigns[existingIndex] = {
        ...appliedCampaigns[existingIndex],
        cashbackAmount: roundMoney(appliedCampaigns[existingIndex].cashbackAmount + cappedCashback),
        cashbackFunding: splitFundingAmount(
          roundMoney(
            Number(appliedCampaigns[existingIndex].cashbackAmount || 0) + cappedCashback
          ),
          campaign
        ),
      }
    } else {
      appliedCampaigns.push(
        normalizeCampaignApplication(
          campaign,
          0,
          cappedCashback,
          resolveCampaignCoverageLitres(campaign, normalizedLitres),
          cashbackDestination
        )
      )
    }
    totalCashback = roundMoney(totalCashback + cappedCashback)
  }

  const stationDiscount = roundMoney(
    appliedCampaigns.reduce((sum, campaign) => sum + Number(campaign.directFunding?.stationAmount || 0), 0)
  )
  const smartlinkDiscount = roundMoney(
    appliedCampaigns.reduce((sum, campaign) => sum + Number(campaign.directFunding?.smartlinkAmount || 0), 0)
  )
  const stationCashback = roundMoney(
    appliedCampaigns.reduce((sum, campaign) => sum + Number(campaign.cashbackFunding?.stationAmount || 0), 0)
  )
  const smartlinkCashback = roundMoney(
    appliedCampaigns.reduce((sum, campaign) => sum + Number(campaign.cashbackFunding?.smartlinkAmount || 0), 0)
  )
  const finalPayable = roundMoney(Math.max(0, subtotal - totalDirectDiscount))
  const effectiveNetCost = finalPayable
  const effectivePricePerLitre = normalizedLitres > 0
    ? roundUnitPrice(effectiveNetCost / normalizedLitres)
    : 0
  const directPricePerLitre = normalizedLitres > 0
    ? roundUnitPrice(finalPayable / normalizedLitres)
    : normalizedBasePricePerLitre
  const promoLabelsApplied = appliedCampaigns.map((campaign) => campaign.campaignLabel)

  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        basePricePerLitre: normalizedBasePricePerLitre,
        litres: normalizedLitres,
        finalPayable,
        totalCashback,
        appliedCampaigns: appliedCampaigns.map((campaign) => ({
          campaignPublicId: campaign.campaignPublicId,
          directDiscountAmount: campaign.directDiscountAmount,
          cashbackAmount: campaign.cashbackAmount,
        })),
      })
    )
    .digest("hex")
    .slice(0, 20)

  return {
    basePricePerLitre: normalizedBasePricePerLitre,
    litres: normalizedLitres,
    subtotal,
    directPricePerLitre,
    stationDiscount,
    smartlinkDiscount,
    totalDirectDiscount,
    stationCashback,
    smartlinkCashback,
    cashback: totalCashback,
    finalPayable,
    effectiveNetCost,
    effectivePricePerLitre,
    appliedCampaigns,
    promoLabelsApplied,
    fingerprint,
    eligibility: eligibleResults.map((result) => ({
      campaignId: result.campaign.id,
      campaignPublicId: result.campaign.publicId,
      campaignLabel: result.campaign.campaignLabel || result.campaign.name,
      isEligible: result.isEligible,
      reasons: result.reasons,
      litresCovered: roundLitres(result.coverageLitres),
    })),
  }
}

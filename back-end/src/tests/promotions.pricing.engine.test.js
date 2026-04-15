import test from "node:test"
import assert from "node:assert/strict"
import { calculateTransactionPricing, evaluateCampaignEligibility } from "../modules/promotions/pricing.engine.js"
import { buildPricingSnapshot } from "../modules/promotions/transactionPricing.service.js"

function buildCampaign(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    publicId: overrides.publicId ?? "01PROMOTIONTEST000000000001",
    name: overrides.name ?? "Campaign",
    campaignLabel: overrides.campaignLabel ?? "Campaign",
    promotionKind: overrides.promotionKind ?? "DISCOUNT",
    fundingSource: overrides.fundingSource ?? "STATION",
    stationSharePct: overrides.stationSharePct ?? 100,
    smartlinkSharePct: overrides.smartlinkSharePct ?? 0,
    discountMode: overrides.discountMode ?? null,
    discountValue: overrides.discountValue ?? null,
    cashbackMode: overrides.cashbackMode ?? null,
    cashbackValue: overrides.cashbackValue ?? null,
    flashPricePerLitre: overrides.flashPricePerLitre ?? null,
    fuelTypeCode: overrides.fuelTypeCode ?? "PETROL",
    startsAt: overrides.startsAt ?? new Date("2026-03-15T08:00:00.000Z"),
    endsAt: overrides.endsAt ?? new Date("2026-03-15T18:00:00.000Z"),
    isActive: overrides.isActive ?? true,
    status: overrides.status ?? "ACTIVE",
    maxRedemptions: overrides.maxRedemptions ?? null,
    redeemedCount: overrides.redeemedCount ?? 0,
    maxLitres: overrides.maxLitres ?? null,
    redeemedLitres: overrides.redeemedLitres ?? 0,
    eligibilityRules: overrides.eligibilityRules ?? {},
  }
}

test("percentage discount calculation applies direct reduction per litre", () => {
  const pricing = calculateTransactionPricing({
    basePricePerLitre: 4990,
    litres: 20,
    fuelTypeCode: "PETROL",
    campaigns: [
      buildCampaign({
        campaignLabel: "Petrol Happy Hour",
        discountMode: "PERCENTAGE_PER_LITRE",
        discountValue: 10,
      }),
    ],
    paymentMethod: "CASH",
    now: new Date("2026-03-15T10:00:00.000Z"),
  })

  assert.equal(pricing.subtotal, 99800)
  assert.equal(pricing.totalDirectDiscount, 9980)
  assert.equal(pricing.finalPayable, 89820)
  assert.equal(pricing.stationDiscount, 9980)
  assert.deepEqual(pricing.promoLabelsApplied, ["Petrol Happy Hour"])
})

test("fixed per litre discount and shared funding split are tracked separately", () => {
  const pricing = calculateTransactionPricing({
    basePricePerLitre: 4820,
    litres: 30,
    fuelTypeCode: "DIESEL",
    campaigns: [
      buildCampaign({
        id: 2,
        publicId: "01PROMOTIONTEST000000000002",
        campaignLabel: "SmartLink Fleet Relief",
        fuelTypeCode: "DIESEL",
        fundingSource: "SHARED",
        stationSharePct: 40,
        smartlinkSharePct: 60,
        discountMode: "FIXED_PER_LITRE",
        discountValue: 120,
      }),
    ],
    paymentMethod: "CARD",
    now: new Date("2026-03-15T10:00:00.000Z"),
  })

  assert.equal(pricing.totalDirectDiscount, 3600)
  assert.equal(pricing.stationDiscount, 1440)
  assert.equal(pricing.smartlinkDiscount, 2160)
  assert.equal(pricing.finalPayable, 141000)
})

test("cashback is calculated separately from direct discount", () => {
  const pricing = calculateTransactionPricing({
    basePricePerLitre: 4990,
    litres: 10,
    fuelTypeCode: "PETROL",
    campaigns: [
      buildCampaign({
        id: 3,
        publicId: "01PROMOTIONTEST000000000003",
        promotionKind: "CASHBACK",
        fundingSource: "SMARTLINK",
        stationSharePct: 0,
        smartlinkSharePct: 100,
        cashbackMode: "PERCENTAGE",
        cashbackValue: 5,
      }),
    ],
    paymentMethod: "SMARTPAY",
    now: new Date("2026-03-15T10:00:00.000Z"),
  })

  assert.equal(pricing.totalDirectDiscount, 0)
  assert.equal(pricing.finalPayable, 49900)
  assert.equal(pricing.cashback, 2495)
  assert.equal(pricing.smartlinkCashback, 2495)
  assert.equal(pricing.effectiveNetCost, 49900)
})

test("expired flash deal is rejected and not applied", () => {
  const campaign = buildCampaign({
    id: 4,
    publicId: "01PROMOTIONTEST000000000004",
    promotionKind: "FLASH_PRICE",
    campaignLabel: "Expired Flash Price",
    discountMode: "FLASH_PRICE_PER_LITRE",
    flashPricePerLitre: 4500,
    endsAt: new Date("2026-03-15T09:00:00.000Z"),
  })

  const eligibility = evaluateCampaignEligibility(campaign, {
    fuelTypeCode: "PETROL",
    litres: 25,
    paymentMethod: "CASH",
    now: new Date("2026-03-15T10:00:00.000Z"),
  })
  assert.equal(eligibility.isEligible, false)
  assert.match(eligibility.reasons.join(" "), /expired/i)

  const pricing = calculateTransactionPricing({
    basePricePerLitre: 4990,
    litres: 25,
    fuelTypeCode: "PETROL",
    campaigns: [campaign],
    paymentMethod: "CASH",
    now: new Date("2026-03-15T10:00:00.000Z"),
  })
  assert.equal(pricing.totalDirectDiscount, 0)
  assert.equal(pricing.promoLabelsApplied.length, 0)
})

test("max redemption cap prevents further application", () => {
  const eligibility = evaluateCampaignEligibility(
    buildCampaign({
      id: 5,
      publicId: "01PROMOTIONTEST000000000005",
      campaignLabel: "Cap Reached",
      discountMode: "FIXED_BASKET",
      discountValue: 3000,
      maxRedemptions: 100,
      redeemedCount: 100,
    }),
    {
      fuelTypeCode: "PETROL",
      litres: 15,
      paymentMethod: "CASH",
      now: new Date("2026-03-15T10:00:00.000Z"),
    }
  )

  assert.equal(eligibility.isEligible, false)
  assert.match(eligibility.reasons.join(" "), /maximum redemptions/i)
})

test("final payable never drops below zero and pricing snapshot remains immutable", () => {
  const pricing = calculateTransactionPricing({
    basePricePerLitre: 100,
    litres: 10,
    fuelTypeCode: "PETROL",
    campaigns: [
      buildCampaign({
        id: 6,
        publicId: "01PROMOTIONTEST000000000006",
        campaignLabel: "Basket Cover",
        discountMode: "FIXED_BASKET",
        discountValue: 5000,
      }),
    ],
    paymentMethod: "CASH",
    now: new Date("2026-03-15T10:00:00.000Z"),
  })

  assert.equal(pricing.finalPayable, 0)
  assert.equal(pricing.totalDirectDiscount, 1000)

  const snapshot = buildPricingSnapshot(pricing, {
    promoLabelsApplied: ["Basket Cover"],
  })
  assert.equal(snapshot.finalPayable, 0)
  assert.equal(snapshot.totalDirectDiscount, 1000)
  assert.deepEqual(snapshot.promoLabelsApplied, ["Basket Cover"])
  assert.ok(snapshot.fingerprint)
})

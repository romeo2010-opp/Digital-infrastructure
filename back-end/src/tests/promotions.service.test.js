import test from "node:test"
import assert from "node:assert/strict"
import { prisma } from "../db/prisma.js"
import {
  getPromotionCampaignByPublicId,
  getPromotionPricingPreview,
} from "../modules/promotions/service.js"

function createQueryRawMock(responses) {
  const queue = [...responses]
  return async () => {
    if (!queue.length) {
      throw new Error("Unexpected prisma.$queryRaw call in promotions.service test.")
    }
    return queue.shift()
  }
}

test("getPromotionCampaignByPublicId serializes station-local campaign datetimes to UTC ISO", { concurrency: false }, async () => {
  const originalQueryRaw = prisma.$queryRaw
  prisma.$queryRaw = createQueryRawMock([
    [
      {
        id: 7,
        public_id: "01PROMOTIONTEST000000000007",
        station_id: 9,
        name: "Morning SmartPay",
        campaign_label: "Morning SmartPay",
        promotion_kind: "DISCOUNT",
        fuel_type_code: "PETROL",
        discount_mode: "PERCENTAGE_PER_LITRE",
        discount_value: 10,
        is_active: 1,
        status: "ACTIVE",
        starts_at_local: "2026-03-15 10:00:00",
        ends_at_local: "2026-03-15 12:00:00",
        created_at: new Date("2026-03-15T07:30:00.000Z"),
        updated_at: new Date("2026-03-15T07:45:00.000Z"),
      },
    ],
  ])

  try {
    const campaign = await getPromotionCampaignByPublicId(9, "01PROMOTIONTEST000000000007", {
      timeZone: "Africa/Blantyre",
    })

    assert.equal(campaign.startsAt, "2026-03-15T08:00:00.000Z")
    assert.equal(campaign.endsAt, "2026-03-15T10:00:00.000Z")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("getPromotionPricingPreview treats SQL campaign datetimes as station-local for eligibility", { concurrency: false }, async () => {
  const originalQueryRaw = prisma.$queryRaw
  const RealDate = globalThis.Date
  const fixedNowIso = "2026-03-15T08:30:00.000Z"

  class MockDate extends RealDate {
    constructor(value) {
      super(value ?? fixedNowIso)
    }

    static now() {
      return new RealDate(fixedNowIso).getTime()
    }
  }

  MockDate.parse = RealDate.parse
  MockDate.UTC = RealDate.UTC

  globalThis.Date = MockDate
  prisma.$queryRaw = createQueryRawMock([
    [
      {
        id: 5,
        public_id: "01STATIONTEST000000000005",
        name: "Limbe",
      },
    ],
    [
      {
        id: 5,
        public_id: "01STATIONTEST000000000005",
        name: "Limbe",
        city: "Blantyre",
        address: "Haile Selassie",
        timezone: "Africa/Blantyre",
        prices_json: JSON.stringify([{ fuelType: "PETROL", pricePerLitre: 5000 }]),
      },
    ],
    [
      {
        id: 11,
        public_id: "01PROMOTIONTEST000000000011",
        station_id: 5,
        name: "Morning SmartPay",
        campaign_label: "Morning SmartPay",
        promotion_kind: "DISCOUNT",
        fuel_type_code: "PETROL",
        discount_mode: "PERCENTAGE_PER_LITRE",
        discount_value: 10,
        is_active: 1,
        status: "ACTIVE",
        starts_at_local: "2026-03-15 10:00:00",
        ends_at_local: "2026-03-15 12:00:00",
        eligibility_rules_json: JSON.stringify({
          paymentMethods: ["SMARTPAY"],
          requiresSmartPay: true,
        }),
      },
    ],
  ])

  try {
    const preview = await getPromotionPricingPreview({
      stationPublicId: "01STATIONTEST000000000005",
      fuelTypeCode: "PETROL",
      litres: 20,
      paymentMethod: "SMARTPAY",
      now: new RealDate(fixedNowIso),
    })

    assert.equal(preview.pricing.totalDirectDiscount, 10000)
    assert.equal(preview.pricing.finalPayable, 90000)
    assert.deepEqual(preview.pricing.promoLabelsApplied, ["Morning SmartPay"])
    assert.equal(preview.pricing.appliedCampaigns[0]?.startsAt, "2026-03-15T08:00:00.000Z")
    assert.equal(preview.pricing.appliedCampaigns[0]?.endsAt, "2026-03-15T10:00:00.000Z")
  } finally {
    prisma.$queryRaw = originalQueryRaw
    globalThis.Date = RealDate
  }
})

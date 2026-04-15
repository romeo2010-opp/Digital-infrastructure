import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCashbackAwardNotification,
  previewPromotionAwarePricing,
} from "../modules/promotions/transactionPricing.service.js"

test("buildCashbackAwardNotification returns wallet cashback credit messaging", () => {
  const notification = buildCashbackAwardNotification({
    station: {
      id: 9,
      public_id: "01STATION000000000000000001",
      name: "SmartLink Blantyre Depot",
    },
    transaction: {
      publicId: "01TX0000000000000000000001",
      stationPublicId: "01STATION000000000000000001",
      receiptVerificationRef: "RCPT-CB123456789",
      cashbackStatus: "CREDITED",
      cashbackDestination: "WALLET",
      cashbackWalletTransactionReference: "WCB-ABC123",
    },
    pricing: {
      cashback: 2250,
      promoLabelsApplied: ["Wallet Boost Cashback"],
    },
  })

  assert.equal(notification?.title, "Cashback credited")
  assert.match(notification?.body || "", /MWK 2,250/)
  assert.equal(notification?.metadata?.cashbackAmount, 2250)
  assert.equal(notification?.metadata?.cashbackStatus, "CREDITED")
  assert.equal(notification?.metadata?.cashbackDestination, "WALLET")
  assert.equal(notification?.metadata?.transactionPublicId, "01TX0000000000000000000001")
  assert.equal(notification?.metadata?.cashbackWalletTransactionReference, "WCB-ABC123")
})

test("buildCashbackAwardNotification skips empty cashback awards", () => {
  assert.equal(
    buildCashbackAwardNotification({
      station: { name: "SmartLink" },
      transaction: { cashbackStatus: "NONE", cashbackDestination: "NONE" },
      pricing: { cashback: 0 },
    }),
    null
  )
})

test("previewPromotionAwarePricing prices a transaction from actual dispensed litres", async () => {
  const db = {
    $queryRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM stations") && queryText.includes("WHERE id =")) {
        return [
          {
            id: 15,
            public_id: "01STATION000000000000000015",
            name: "SmartLink Kanengo",
            timezone: "Africa/Blantyre",
            prices_json: JSON.stringify([
              { label: "PETROL", pricePerLitre: 5000 },
            ]),
          },
        ]
      }

      if (queryText.includes("FROM fuel_types") && queryText.includes("WHERE code =")) {
        return [{ id: 1, code: "PETROL" }]
      }

      if (queryText.includes("FROM promotion_campaigns pc")) {
        return []
      }

      throw new Error(`Unexpected query: ${queryText} :: ${JSON.stringify(values)}`)
    },
  }

  const preview = await previewPromotionAwarePricing(db, {
    stationId: 15,
    fuelTypeCode: "PETROL",
    litres: 15,
    paymentMethod: "SMARTPAY",
    userId: 700,
  })

  assert.equal(preview.station.public_id, "01STATION000000000000000015")
  assert.equal(preview.fuelType.code, "PETROL")
  assert.equal(preview.pricing.litres, 15)
  assert.equal(preview.pricing.basePricePerLitre, 5000)
  assert.equal(preview.pricing.finalPayable, 75000)
  assert.equal(preview.pricing.effectivePricePerLitre, 5000)
})

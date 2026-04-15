import test from "node:test"
import assert from "node:assert/strict"
import { buildReceiptPayload, getUserTransactionReceiptPayloadByLink } from "../modules/transactions/receipt.service.js"
import { prisma } from "../db/prisma.js"

test("receipt payload includes immutable pricing, discount, cashback, and verification fields", () => {
  const payload = buildReceiptPayload(
    {
      public_id: "01TRANSACTIONRECEIPT0000001",
      payment_reference: "MM-REF-7788",
      station_name: "SmartLink Blantyre Depot",
      station_location: "Masauko Chipembere Highway, Blantyre",
      occurred_at: "2026-03-15T10:30:00.000Z",
      pump_number: 4,
      nozzle_number: "2",
      nozzle_side: "A",
      fuel_code: "PETROL",
      litres: "25.000",
      base_price_per_litre: "4990.0000",
      subtotal: "124750.00",
      total_direct_discount: "9750.00",
      cashback_total: "2250.00",
      final_amount_paid: "115000.00",
      effective_price_per_litre: "4510.0000",
      queue_public_id: "01QUEUE000000000000000001",
      reservation_public_id: "01RSV0000000000000000001",
      receipt_verification_ref: "RCPT-ABC123456789",
      payment_method: "MOBILE_MONEY",
      cashback_status: "CREDITED",
      cashback_destination: "WALLET",
      cashback_credited_at: "2026-03-15T10:35:00.000Z",
      promo_labels_applied: JSON.stringify(["Flash Rush", "Wallet Cashback"]),
      pricing_snapshot_json: JSON.stringify({
        promoLabelsApplied: ["Flash Rush", "Wallet Cashback"],
      }),
    },
    [
      {
        campaign_label: "Flash Rush",
        funding_source: "SHARED",
        promotion_kind: "FLASH_PRICE",
        snapshot_json: JSON.stringify({
          discountMode: "FLASH_PRICE_PER_LITRE",
          flashPricePerLitre: 4600,
        }),
        direct_discount_amount: 9750,
      },
      {
        campaign_label: "Wallet Cashback",
        promotion_kind: "CASHBACK",
        snapshot_json: JSON.stringify({
          cashbackMode: "PERCENTAGE",
          cashbackValue: 5,
        }),
        cashback_amount: 2250,
        cashback_status: "CREDITED",
        cashback_destination: "WALLET",
      },
    ]
  )

  assert.equal(payload.transactionId, "01TRANSACTIONRECEIPT0000001")
  assert.equal(payload.reference, "MM-REF-7788")
  assert.equal(payload.stationName, "SmartLink Blantyre Depot")
  assert.equal(payload.nozzleLabel, "2 (A)")
  assert.equal(payload.baseSubtotal, 124750)
  assert.equal(payload.totalDirectDiscount, 9750)
  assert.equal(payload.cashbackTotal, 2250)
  assert.equal(payload.finalAmountPaid, 115000)
  assert.equal(payload.effectivePricePerLitre, 4510)
  assert.deepEqual(payload.promoLabelsApplied, ["Flash Rush", "Wallet Cashback"])
  assert.equal(payload.discountLines[0].label, "Flash Rush")
  assert.equal(payload.discountLines[0].promotionKind, "Flash Price")
  assert.equal(payload.discountLines[0].promotionValueLabel, "MWK 4,600/L")
  assert.equal(payload.cashbackLines[0].status, "CREDITED")
  assert.equal(payload.cashbackLines[0].promotionKind, "Cashback")
  assert.equal(payload.cashbackLines[0].promotionValueLabel, "5% cashback")
  assert.equal(payload.queueJoinId, "01QUEUE000000000000000001")
  assert.equal(payload.reservationId, "01RSV0000000000000000001")
  assert.equal(payload.pumpNumber, 4)
  assert.match(payload.verificationUrl, /verify\/receipts\/RCPT-ABC123456789/)
})

test("receipt payload prefers physical dispensed litres and posted wallet amount when available", () => {
  const payload = buildReceiptPayload({
    public_id: "01TRANSACTIONPROOF0000000001",
    payment_reference: "WPM-PROOF-001",
    station_name: "SmartLink Kanengo",
    occurred_at: "2026-03-15T10:30:00.000Z",
    fuel_code: "PETROL",
    litres: "40.000",
    dispensed_litres: "25.000",
    base_price_per_litre: "4600.0000",
    subtotal: "184000.00",
    final_amount_paid: "184000.00",
    wallet_amount: "115000.00",
    effective_price_per_litre: "4600.0000",
    receipt_verification_ref: "RCPT-PROOF-001",
    payment_method: "SMARTPAY",
  })

  assert.equal(payload.litres, 25)
  assert.equal(payload.baseSubtotal, 115000)
  assert.equal(payload.finalAmountPaid, 115000)
  assert.equal(payload.effectivePricePerLitre, 4600)
})

test("linked user receipt falls back to service transaction metadata when direct reservation link is unavailable", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let transactionQuerySeen = false

  prisma.$queryRaw = async (strings, ...values) => {
    const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

    if (queryText.includes("FROM transactions t") && queryText.includes("t.reservation_public_id")) {
      return []
    }

    if (queryText.includes("FROM user_reservations")) {
      return [
        {
          metadata: JSON.stringify({
            serviceTransaction: {
              publicId: "01TRANSACTIONLINKED000000001",
            },
          }),
        },
      ]
    }

    if (queryText.includes("FROM transactions t") && queryText.includes("WHERE t.public_id = ")) {
      transactionQuerySeen = true
      return [
        {
          id: 77,
          public_id: "01TRANSACTIONLINKED000000001",
          payment_reference: "WCB-REF-100",
          station_name: "SmartLink Kanengo",
          station_city: "Lilongwe",
          station_address: "Kanengo",
          station_location: "Kanengo, Lilongwe",
          pump_number: 3,
          nozzle_number: "1",
          nozzle_side: "B",
          fuel_code: "PETROL",
          litres: "20.000",
          base_price_per_litre: "5000.0000",
          subtotal: "100000.00",
          total_direct_discount: "2000.00",
          cashback_total: "1500.00",
          final_amount_paid: "98000.00",
          effective_price_per_litre: "4825.0000",
          queue_public_id: "01QUEUE000000000000000009",
          reservation_public_id: "01RSV0000000000000000009",
          receipt_verification_ref: "RCPT-LINKED123456",
          payment_method: "SMARTPAY",
          cashback_status: "CREDITED",
          cashback_destination: "WALLET",
          cashback_credited_at: "2026-03-15T10:35:00.000Z",
          promo_labels_applied: JSON.stringify(["Wallet Boost Cashback"]),
          pricing_snapshot_json: JSON.stringify({
            promoLabelsApplied: ["Wallet Boost Cashback"],
          }),
          occurred_at: "2026-03-15T10:30:00.000Z",
        },
      ]
    }

    if (queryText.includes("FROM ledger_transactions lt")) {
      return [
        {
          net_amount: "97500.00",
          gross_amount: "97500.00",
        },
      ]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
      return [
        {
          dispensed_litres: "19.500",
        },
      ]
    }

    if (queryText.includes("FROM ledger_transactions lt")) {
      return [
        {
          net_amount: "72000.00",
          gross_amount: "72000.00",
        },
      ]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
      return [
        {
          dispensed_litres: "14.250",
        },
      ]
    }

    if (queryText.includes("FROM ledger_transactions lt")) {
      return [
        {
          net_amount: "72000.00",
          gross_amount: "72000.00",
        },
      ]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
      return [
        {
          dispensed_litres: "14.250",
        },
      ]
    }

    if (queryText.includes("FROM ledger_transactions lt")) {
      return [
        {
          net_amount: "72000.00",
          gross_amount: "72000.00",
        },
      ]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
      return [
        {
          dispensed_litres: "14.250",
        },
      ]
    }

    if (queryText.includes("FROM promotion_redemptions pr")) {
      return [
        {
          campaign_label: "Wallet Boost Cashback",
          campaign_name: "Wallet Boost Cashback",
          funding_source: "SMARTLINK",
          promotion_kind: "CASHBACK",
          snapshot_json: JSON.stringify({
            cashbackMode: "FIXED_AMOUNT",
            cashbackValue: 1500,
          }),
          cashback_amount: 1500,
          cashback_status: "CREDITED",
          cashback_destination: "WALLET",
        },
      ]
    }

    throw new Error(`Unexpected query in test: ${queryText} :: ${JSON.stringify(values)}`)
  }

  try {
    const payload = await getUserTransactionReceiptPayloadByLink({
      userId: 5,
      receiptType: "reservation",
      reference: "01RSV0000000000000000009",
    })

    assert.equal(transactionQuerySeen, true)
    assert.equal(payload?.transactionId, "01TRANSACTIONLINKED000000001")
    assert.equal(payload?.paymentMethod, "SMARTPAY")
    assert.equal(payload?.finalAmountPaid, 97500)
    assert.equal(payload?.litres, 19.5)
    assert.equal(payload?.cashbackTotal, 1500)
    assert.equal(payload?.cashbackLines?.[0]?.label, "Wallet Boost Cashback")
    assert.equal(payload?.cashbackLines?.[0]?.promotionKind, "Cashback")
    assert.equal(payload?.cashbackLines?.[0]?.promotionValueLabel, "MWK 1,500 cashback")
    assert.equal(payload?.pumpNumber, 3)
    assert.equal(payload?.nozzleLabel, "1 (B)")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("linked queue receipt falls back to reservation service transaction metadata when queue transaction link is unavailable", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let transactionQuerySeen = false

  prisma.$queryRaw = async (strings, ...values) => {
    const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

    if (queryText.includes("FROM transactions t") && queryText.includes("qe.public_id = ")) {
      return []
    }

    if (queryText.includes("FROM queue_entries") && queryText.includes("WHERE user_id = ")) {
      return [
        {
          metadata: JSON.stringify({}),
        },
      ]
    }

    if (queryText.includes("FROM user_reservations ur") && queryText.includes("INNER JOIN queue_entries qe")) {
      return [
        {
          metadata: JSON.stringify({
            serviceTransaction: {
              publicId: "01TRANSACTIONQUEUEFALLBACK0001",
            },
          }),
        },
      ]
    }

    if (queryText.includes("FROM transactions t") && queryText.includes("WHERE t.public_id = ")) {
      transactionQuerySeen = true
      return [
        {
          id: 91,
          public_id: "01TRANSACTIONQUEUEFALLBACK0001",
          payment_reference: "WPM-QUEUE-001",
          station_name: "SmartLink Kanengo",
          station_city: "Lilongwe",
          station_address: "Kanengo",
          station_location: "Kanengo, Lilongwe",
          pump_number: 1,
          nozzle_number: "A1",
          nozzle_side: "RIGHT",
          fuel_code: "PETROL",
          litres: "15.000",
          base_price_per_litre: "5000.0000",
          subtotal: "75000.00",
          total_direct_discount: "2250.00",
          cashback_total: "750.00",
          final_amount_paid: "72750.00",
          effective_price_per_litre: "4850.0000",
          queue_public_id: "5CN0SXRA5HP1KQHSPFET1SK6ZK",
          reservation_public_id: "01RSVQUEUE000000000000001",
          receipt_verification_ref: "RCPT-QUEUE-LINK-12345",
          payment_method: "SMARTPAY",
          cashback_status: "CREDITED",
          cashback_destination: "WALLET",
          cashback_credited_at: "2026-03-15T10:35:00.000Z",
          promo_labels_applied: JSON.stringify(["Flash Rush", "Wallet Cashback"]),
          pricing_snapshot_json: JSON.stringify({
            promoLabelsApplied: ["Flash Rush", "Wallet Cashback"],
          }),
          occurred_at: "2026-03-15T10:20:00.000Z",
        },
      ]
    }

    if (queryText.includes("FROM ledger_transactions lt")) {
      return [
        {
          net_amount: "72000.00",
          gross_amount: "72000.00",
        },
      ]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
      return [
        {
          dispensed_litres: "14.250",
        },
      ]
    }

    if (queryText.includes("FROM promotion_redemptions pr")) {
      return [
        {
          campaign_label: "Flash Rush",
          campaign_name: "Flash Rush",
          funding_source: "SHARED",
          promotion_kind: "FLASH_PRICE",
          snapshot_json: JSON.stringify({
            discountMode: "FLASH_PRICE_PER_LITRE",
            flashPricePerLitre: 4850,
          }),
          direct_discount_amount: 2250,
        },
        {
          campaign_label: "Wallet Cashback",
          campaign_name: "Wallet Cashback",
          funding_source: "SMARTLINK",
          promotion_kind: "CASHBACK",
          snapshot_json: JSON.stringify({
            cashbackMode: "PERCENTAGE",
            cashbackValue: 1,
          }),
          cashback_amount: 750,
          cashback_status: "CREDITED",
          cashback_destination: "WALLET",
        },
      ]
    }

    throw new Error(`Unexpected query in test: ${queryText} :: ${JSON.stringify(values)}`)
  }

  try {
    const payload = await getUserTransactionReceiptPayloadByLink({
      userId: 9,
      receiptType: "queue",
      reference: "5CN0SXRA5HP1KQHSPFET1SK6ZK",
    })

    assert.equal(transactionQuerySeen, true)
    assert.equal(payload?.transactionId, "01TRANSACTIONQUEUEFALLBACK0001")
    assert.equal(payload?.finalAmountPaid, 72000)
    assert.equal(payload?.litres, 14.25)
    assert.equal(payload?.queueJoinId, "5CN0SXRA5HP1KQHSPFET1SK6ZK")
    assert.equal(payload?.discountLines?.[0]?.promotionKind, "Flash Price")
    assert.equal(payload?.discountLines?.[0]?.promotionValueLabel, "MWK 4,850/L")
    assert.equal(payload?.cashbackLines?.[0]?.promotionKind, "Cashback")
    assert.equal(payload?.cashbackLines?.[0]?.promotionValueLabel, "1% cashback")
    assert.equal(payload?.pumpNumber, 1)
    assert.equal(payload?.nozzleLabel, "A1 (RIGHT)")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("receipt payload falls back to '-' for promotion details when campaign metadata is unavailable", () => {
  const payload = buildReceiptPayload(
    {
      public_id: "01TRANSACTIONRECEIPT0000002",
      station_name: "SmartLink Depot",
      occurred_at: "2026-03-15T10:30:00.000Z",
      fuel_code: "PETROL",
      litres: "10.000",
      base_price_per_litre: "5000.0000",
      subtotal: "50000.00",
      total_direct_discount: "1000.00",
      final_amount_paid: "49000.00",
      effective_price_per_litre: "4900.0000",
      pricing_snapshot_json: JSON.stringify({}),
    },
    [
      {
        campaign_label: "",
        funding_source: "",
        promotion_kind: "",
        snapshot_json: JSON.stringify({}),
        direct_discount_amount: 1000,
      },
    ]
  )

  assert.equal(payload.discountLines[0].label, "-")
  assert.equal(payload.discountLines[0].promotionKind, "-")
  assert.equal(payload.discountLines[0].promotionValueLabel, "-")
})

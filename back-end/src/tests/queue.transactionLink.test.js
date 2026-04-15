import test from "node:test"
import assert from "node:assert/strict"
import { prisma } from "../db/prisma.js"
import {
  createQueueServiceTransaction,
  createReservationServiceTransaction,
  deriveQueueWalletSettledLitres,
  resolvePromotionAwareServiceAmount,
  resolveQueueServiceLitres,
  resolveReservationServiceHardware,
  resolvePostedWalletPaymentAmount,
  resolveQueueServicePaymentReference,
  resolveQueueSettlementPaymentMethod,
  resolveReservationServiceAmount,
  resolveReservationServiceLitres,
  resolveReservationServiceLitresFromForecourt,
  resolveReservationSettlementPaymentMethod,
  shouldCreateQueueServiceTransaction,
} from "../modules/queue/routes.js"
import {
  buildQueueReceiptPayload,
  buildReservationReceiptPayload,
} from "../modules/userQueue/routes.js"

test("resolveReservationServiceHardware resolves assigned pump and nozzle from queue metadata", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let queryCount = 0

  prisma.$queryRaw = async () => {
    queryCount += 1
    return [
      {
        id: 81,
        public_id: "01NOZZLEQUEUEPREPAY000000001",
        pump_id: 44,
        pump_public_id: "01PUMPQUEUEPREPAY0000000001",
      },
    ]
  }

  try {
    const hardware = await resolveReservationServiceHardware(15, {
      metadata: JSON.stringify({
        lastPumpScan: {
          pumpPublicId: "01PUMPQUEUEPREPAY0000000001",
        },
        serviceRequest: {
          nozzlePublicId: "01NOZZLEQUEUEPREPAY000000001",
        },
      }),
    })

    assert.equal(queryCount, 1)
    assert.deepEqual(hardware, {
      pumpId: 44,
      nozzleId: 81,
      pumpPublicId: "01PUMPQUEUEPREPAY0000000001",
      nozzlePublicId: "01NOZZLEQUEUEPREPAY000000001",
    })
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("resolveReservationServiceHardware returns null linkage when no assigned nozzle exists", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let queryCount = 0

  prisma.$queryRaw = async () => {
    queryCount += 1
    return []
  }

  try {
    const hardware = await resolveReservationServiceHardware(15, {
      metadata: JSON.stringify({
        paymentMode: "PREPAY",
      }),
    })

    assert.equal(queryCount, 0)
    assert.deepEqual(hardware, {
      pumpId: null,
      nozzleId: null,
      pumpPublicId: null,
      nozzlePublicId: null,
    })
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("resolveReservationSettlementPaymentMethod marks captured wallet settlements as SMARTPAY", () => {
  assert.equal(
    resolveReservationSettlementPaymentMethod({
      paymentMethod: "CASH",
      settlementCapture: {
        transaction: {
          reference: "WALLET-TX-001",
        },
      },
    }),
    "SMARTPAY"
  )
})

test("resolveReservationSettlementPaymentMethod preserves explicit forecourt payment methods when no settlement exists", () => {
  assert.equal(
    resolveReservationSettlementPaymentMethod({
      paymentMethod: "mobile_money",
      settlementCapture: null,
    }),
    "MOBILE_MONEY"
  )
  assert.equal(resolveReservationSettlementPaymentMethod({}), "OTHER")
})

test("resolveQueueSettlementPaymentMethod marks prepaid queue settlements as SMARTPAY", () => {
  assert.equal(
    resolveQueueSettlementPaymentMethod({
      paymentMethod: "CASH",
      queueEntry: {
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PREPAY",
            walletTransactionReference: "WPM-QUEUE-001",
            settlementBatchPublicId: "SET-QUEUE-001",
          },
        }),
      },
    }),
    "SMARTPAY"
  )
})

test("resolveQueueSettlementPaymentMethod treats held queue prepay requests as SMARTPAY", () => {
  assert.equal(
    resolveQueueSettlementPaymentMethod({
      paymentMethod: "CASH",
      queueEntry: {
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PREPAY",
            holdReference: "WRH-QUEUE-001",
          },
        }),
      },
    }),
    "SMARTPAY"
  )
})

test("resolveQueueSettlementPaymentMethod marks queue settlement as SMARTPAY when a payment reference exists", () => {
  assert.equal(
    resolveQueueSettlementPaymentMethod({
      paymentMethod: "OTHER",
      paymentReference: "WQP-QUEUE-001",
      queueEntry: {
        metadata: JSON.stringify({
          paymentMode: "PREPAY",
          prepaySelected: true,
        }),
      },
    }),
    "SMARTPAY"
  )
})

test("resolveQueueSettlementPaymentMethod does not mark queue-join prepay preference as settled SmartPay by itself", () => {
  assert.equal(
    resolveQueueSettlementPaymentMethod({
      paymentMethod: null,
      queueEntry: {
        metadata: JSON.stringify({
          paymentMode: "PREPAY",
          prepaySelected: true,
        }),
      },
    }),
    "OTHER"
  )
})

test("resolveQueueSettlementPaymentMethod preserves explicit forecourt payment methods for pay-at-pump queue entries", () => {
  assert.equal(
    resolveQueueSettlementPaymentMethod({
      paymentMethod: "card",
      queueEntry: {
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PAY_AT_PUMP",
          },
        }),
      },
    }),
    "CARD"
  )
  assert.equal(resolveQueueSettlementPaymentMethod({}), "OTHER")
})

test("resolvePostedWalletPaymentAmount returns the posted wallet payment amount for a payment reference", async () => {
  let capturedPaymentReference = null
  const db = {
    $queryRaw: async (strings, ...values) => {
      capturedPaymentReference = values[0]
      return [
        {
          net_amount: "43250.75",
          gross_amount: "43250.75",
        },
      ]
    },
  }

  const amount = await resolvePostedWalletPaymentAmount(db, {
    paymentReference: "WPM-QUEUE-001",
  })

  assert.equal(capturedPaymentReference, "WPM-QUEUE-001")
  assert.equal(amount, 43250.75)
})

test("resolvePostedWalletPaymentAmount returns null when the payment reference is missing or not posted", async () => {
  let queryCount = 0
  const db = {
    $queryRaw: async () => {
      queryCount += 1
      return []
    },
  }

  assert.equal(await resolvePostedWalletPaymentAmount(db, {}), null)
  assert.equal(queryCount, 0)
  assert.equal(
    await resolvePostedWalletPaymentAmount(db, {
      paymentReference: "WPM-MISSING-001",
    }),
    null
  )
  assert.equal(queryCount, 1)
})

test("shouldCreateQueueServiceTransaction creates user-linked pay-at-pump queue transactions when service totals are provided", () => {
  assert.equal(
    shouldCreateQueueServiceTransaction({
      queueEntry: {
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PAY_AT_PUMP",
          },
        }),
      },
      litres: 20,
      amount: 90000,
      paymentMethod: "CARD",
    }),
    true
  )
})

test("resolveQueueServicePaymentReference falls back to persisted wallet settlement metadata", async () => {
  let queryCount = 0
  const db = {
    $queryRaw: async () => {
      queryCount += 1
      return []
    },
  }

  const paymentReference = await resolveQueueServicePaymentReference(db, {
    public_id: "01QUEUEPAYREF00000000000001",
    metadata: JSON.stringify({
      walletSettlement: {
        transactionReference: "WPM-QUEUE-SETTLED-001",
      },
    }),
  })

  assert.equal(paymentReference, "WPM-QUEUE-SETTLED-001")
  assert.equal(queryCount, 0)
})

test("shouldCreateQueueServiceTransaction attempts queue settlement when prepay was selected at join", () => {
  assert.equal(
    shouldCreateQueueServiceTransaction({
      queueEntry: {
        metadata: JSON.stringify({
          paymentMode: "PREPAY",
          prepaySelected: true,
        }),
      },
      litres: 20,
      amount: null,
      paymentMethod: null,
    }),
    true
  )
})

test("createQueueServiceTransaction rejects SmartPay completion without a captured wallet payment reference", async () => {
  const db = {
    $queryRaw: async () => [],
  }

  await assert.rejects(
    createQueueServiceTransaction(db, {
      stationId: 15,
      queueEntry: {
        id: 99,
        public_id: "01QUEUEPAYREFCHECK0000000001",
        user_id: 700,
        fuel_code: "PETROL",
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PREPAY",
            prepaySelected: true,
            paymentStatus: "PENDING",
          },
        }),
      },
      actorUserId: 700,
      litres: 20,
      amount: null,
      paymentMethod: "SMARTPAY",
      paymentReference: null,
    }),
    /requires a captured wallet payment reference/
  )
})

test("shouldCreateQueueServiceTransaction skips queue transactions until litres and amount are available", () => {
  assert.equal(
    shouldCreateQueueServiceTransaction({
      queueEntry: {
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PAY_AT_PUMP",
          },
        }),
      },
      litres: null,
      amount: 90000,
      paymentMethod: "CARD",
    }),
    false
  )
})

test("shouldCreateQueueServiceTransaction allows SmartPay queue transactions when litres are known and wallet settlement is authoritative", () => {
  assert.equal(
    shouldCreateQueueServiceTransaction({
      queueEntry: {
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PREPAY",
            walletTransactionReference: "WPM-QUEUE-001",
          },
        }),
      },
      litres: 20,
      amount: null,
      paymentMethod: null,
    }),
    true
  )
})

test("resolveQueueServiceLitres prefers forecourt pump session litres over requested queue litres", async () => {
  const amount = await resolveQueueServiceLitres({
    $queryRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps")) {
        return [
          {
            dispensed_litres: "23.750",
          },
        ]
      }

      if (queryText.includes("FROM pump_telemetry_logs ptl")) {
        return []
      }

      throw new Error(`Unexpected query in test: ${queryText} :: ${JSON.stringify(values)}`)
    },
  }, {
    stationId: 15,
    queueEntry: {
      metadata: JSON.stringify({}),
    },
    fallbackLitres: 40,
    hardware: {
      pumpId: 4,
      nozzleId: 8,
    },
    occurredAt: new Date("2026-03-22T08:00:00.000Z"),
  })

  assert.equal(amount, 23.75)
})

test("resolveQueueServiceLitres falls back to telemetry litres before queue preview litres", async () => {
  const amount = await resolveQueueServiceLitres({
    $queryRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps")) {
        return []
      }

      if (queryText.includes("FROM pump_telemetry_logs ptl")) {
        return [
          {
            litres_value: "19.500",
          },
        ]
      }

      throw new Error(`Unexpected query in test: ${queryText} :: ${JSON.stringify(values)}`)
    },
  }, {
    stationId: 15,
    queueEntry: {
      metadata: JSON.stringify({}),
    },
    fallbackLitres: 40,
    hardware: {
      pumpId: 4,
      nozzleId: 8,
    },
    occurredAt: new Date("2026-03-22T08:00:00.000Z"),
  })

  assert.equal(amount, 19.5)
})

test("deriveQueueWalletSettledLitres uses wallet settlement when it matches the requested queue litres", () => {
  assert.equal(
    deriveQueueWalletSettledLitres({
      settledAmount: 64870,
      basePricePerLitre: 4990,
      requestedLitres: 13,
      fallbackLitres: 40,
    }),
    13
  )
})

test("deriveQueueWalletSettledLitres refuses wallet-derived litres that do not match the queue request", () => {
  assert.equal(
    deriveQueueWalletSettledLitres({
      settledAmount: 64870,
      basePricePerLitre: 4990,
      requestedLitres: 20,
      fallbackLitres: 40,
    }),
    null
  )
})

test("resolvePromotionAwareServiceAmount returns the final payable based on actual dispensed litres", async () => {
  const db = {
    $queryRaw: async (strings) => {
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

      throw new Error(`Unexpected query: ${queryText}`)
    },
  }

  const amount = await resolvePromotionAwareServiceAmount(db, {
    stationId: 15,
    fuelTypeCode: "PETROL",
    litres: 15,
    paymentMethod: "SMARTPAY",
    userId: 700,
  })

  assert.equal(amount, 75000)
})

test("createQueueServiceTransaction fails loudly when fuel type linkage is missing", async () => {
  const db = {
    $queryRaw: async () => [],
  }

  await assert.rejects(
    createQueueServiceTransaction(db, {
      stationId: 15,
      queueEntry: {
        id: 99,
        user_id: 700,
        metadata: JSON.stringify({
          serviceRequest: {
            paymentMode: "PAY_AT_PUMP",
          },
        }),
      },
      actorUserId: 700,
      litres: 20,
      amount: 90000,
      paymentMethod: "CARD",
      paymentReference: "CARD-QUEUE-001",
    }),
    /requires a fuel type/
  )
})

test("createReservationServiceTransaction fails loudly when amount cannot be resolved", async () => {
  const db = {
    $queryRaw: async () => [],
  }

  await assert.rejects(
    createReservationServiceTransaction(db, {
      stationId: 15,
      reservation: {
        public_id: "01RSVTEST000000000000000001",
        requested_litres: "20.000",
        metadata: JSON.stringify({}),
      },
      actorUserId: 700,
      litres: 20,
      amount: null,
      paymentMethod: "CARD",
      paymentReference: "CARD-RSV-001",
    }),
    /requires a settled or explicit amount/
  )
})

test("reservation service litres require actual served litres and never fall back to requested previews", () => {
  assert.equal(
    resolveReservationServiceLitres(
      {
        requested_litres: "40.000",
        metadata: JSON.stringify({
          requestedLiters: 40,
        }),
      },
      null
    ),
    null
  )
  assert.equal(resolveReservationServiceLitres({}, 18.5), 18.5)
})

test("reservation service litres prefer forecourt proof and otherwise accept explicit completion litres", async () => {
  const db = {
    $queryRaw: async () => [
      {
        dispensed_litres: "19.500",
      },
    ],
  }

  const telemetryResolved = await resolveReservationServiceLitresFromForecourt(db, {
    stationId: 15,
    reservation: {
      metadata: JSON.stringify({
        serviceRequest: {
          nozzlePublicId: "01NOZZLEQUEUEPREPAY000000001",
        },
      }),
    },
    fallbackLitres: 18,
    hardware: {
      pumpId: 4,
      nozzleId: 8,
    },
    occurredAt: new Date("2026-03-22T08:00:00.000Z"),
  })
  assert.equal(telemetryResolved, 19.5)

  const explicitResolved = await resolveReservationServiceLitresFromForecourt(
    {
      $queryRaw: async () => [],
    },
    {
      stationId: 15,
      reservation: {
        requested_litres: "40.000",
        metadata: JSON.stringify({
          requestedLiters: 40,
        }),
      },
      fallbackLitres: 18.5,
      hardware: {
        pumpId: 4,
        nozzleId: 8,
      },
      occurredAt: new Date("2026-03-22T08:00:00.000Z"),
    }
  )
  assert.equal(explicitResolved, 18.5)
})

test("reservation service amount only accepts settled or explicit amounts", () => {
  assert.equal(
    resolveReservationServiceAmount(
      {
        prices_json: JSON.stringify([{ label: "PETROL", price: 5000 }]),
      },
      {
        requested_litres: "40.000",
        metadata: JSON.stringify({
          pricing: {
            estimatedFuelCost: 200000,
            pricePerLitre: 5000,
          },
        }),
      },
      {
        litres: 40,
      }
    ),
    null
  )
  assert.equal(
    resolveReservationServiceAmount(
      {},
      {},
      {
        settlementAmount: 43250.756,
      }
    ),
    43250.76
  )
})

test("queue receipt payload prefers persisted transaction money over preview metadata", () => {
  const payload = buildQueueReceiptPayload({
    queue_join_public_id: "01QUEUEPAYLOAD0000000000001",
    queue_status: "SERVED",
    joined_at: "2026-03-20T08:00:00.000Z",
    served_at: "2026-03-20T08:22:00.000Z",
    metadata: JSON.stringify({
      paymentMode: "PREPAY",
      requestedLiters: 20,
      lastPumpScan: {
        pumpNumber: 7,
      },
      serviceRequest: {
        estimatedAmount: 150000,
        pricePerLitre: 6000,
        promoLabelsApplied: ["Preview Promo"],
        totalDirectDiscount: 12000,
        cashbackTotal: 3000,
      },
    }),
    fuel_type: "PETROL",
    station_name: "SmartLink Kanengo",
    station_area: "Lilongwe",
    transaction_public_id: "01TXQUEUEPAYLOAD000000001",
    receipt_verification_ref: "RCPT-QUEUE-REAL-001",
    payment_reference: "PAY-QUEUE-001",
    litres: "18.500",
    base_price_per_litre: "5000.0000",
    price_per_litre: "5000.0000",
    effective_price_per_litre: "4700.0000",
    subtotal: "100000.00",
    total_direct_discount: "6000.00",
    cashback_total: "1500.00",
    final_amount_paid: "94000.00",
    total_amount: "94000.00",
    wallet_total_amount: "91000.00",
    promo_labels_applied: JSON.stringify(["Real Promo"]),
  })

  assert.equal(payload.transactionId, "01TXQUEUEPAYLOAD000000001")
  assert.equal(payload.litres, 18.5)
  assert.equal(payload.unitPrice, 5000)
  assert.equal(payload.baseSubtotal, 100000)
  assert.equal(payload.totalDirectDiscount, 6000)
  assert.equal(payload.cashbackTotal, 1500)
  assert.equal(payload.finalAmountPaid, 91000)
  assert.equal(payload.effectivePricePerLitre, 4700)
  assert.deepEqual(payload.promoLabelsApplied, ["Real Promo"])
  assert.equal(payload.verificationReference, "RCPT-QUEUE-REAL-001")
})

test("reservation receipt payload prefers persisted transaction money over preview metadata", () => {
  const payload = buildReservationReceiptPayload({
    reservation_public_id: "01RSVREALPAYLOAD0000000001",
    reservation_status: "FULFILLED",
    requested_litres: "30.000",
    slot_end: "2026-03-20T09:00:00.000Z",
    fulfilled_at: "2026-03-20T09:10:00.000Z",
    metadata: JSON.stringify({
      pricing: {
        estimatedFuelCost: 210000,
        payablePricePerLitre: 7000,
        promoLabelsApplied: ["Reservation Preview"],
        totalDirectDiscount: 15000,
        cashback: 5000,
      },
      walletHold: {
        reference: "WALLET-HOLD-001",
        status: "HELD",
      },
      lastPumpScan: {
        pumpNumber: 4,
      },
    }),
    fuel_type: "DIESEL",
    station_name: "SmartLink Blantyre",
    station_area: "Blantyre",
    transaction_public_id: "01TXRSVPAYLOAD00000000001",
    receipt_verification_ref: "RCPT-RSV-REAL-001",
    payment_reference: "PAY-RSV-001",
    litres: "28.250",
    base_price_per_litre: "6500.0000",
    price_per_litre: "6500.0000",
    effective_price_per_litre: "6200.0000",
    subtotal: "195000.00",
    total_direct_discount: "8000.00",
    cashback_total: "2500.00",
    final_amount_paid: "187000.00",
    total_amount: "187000.00",
    wallet_total_amount: "186500.00",
    promo_labels_applied: JSON.stringify(["Reservation Real Promo"]),
  })

  assert.equal(payload.transactionId, "01TXRSVPAYLOAD00000000001")
  assert.equal(payload.litres, 28.25)
  assert.equal(payload.unitPrice, 6500)
  assert.equal(payload.baseSubtotal, 195000)
  assert.equal(payload.totalDirectDiscount, 8000)
  assert.equal(payload.cashbackTotal, 2500)
  assert.equal(payload.finalAmountPaid, 186500)
  assert.equal(payload.effectivePricePerLitre, 6200)
  assert.deepEqual(payload.promoLabelsApplied, ["Reservation Real Promo"])
  assert.equal(payload.verificationReference, "RCPT-RSV-REAL-001")
})

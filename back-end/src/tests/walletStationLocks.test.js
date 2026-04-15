import test from "node:test"
import assert from "node:assert/strict"
import {
  buildWalletStationLockSpendPlan,
  consumeWalletStationLocks,
} from "../modules/common/walletStationLocks.js"

test("buildWalletStationLockSpendPlan consumes matching station locks before general balance", () => {
  const plan = buildWalletStationLockSpendPlan({
    amount: 50,
    availableBalance: 40,
    matchingLocks: [
      { amountMwkRemaining: 30 },
    ],
  })

  assert.equal(plan.lockedAmountUsed, 30)
  assert.equal(plan.generalAmountUsed, 20)
  assert.equal(plan.totalSpendable, 70)
  assert.equal(plan.shortfallAmount, 0)
  assert.equal(plan.canSpend, true)
})

test("buildWalletStationLockSpendPlan ignores locked balance for non-matching stations", () => {
  const plan = buildWalletStationLockSpendPlan({
    amount: 50,
    availableBalance: 40,
    matchingLocks: [],
  })

  assert.equal(plan.lockedAmountUsed, 0)
  assert.equal(plan.generalAmountUsed, 50)
  assert.equal(plan.totalSpendable, 40)
  assert.equal(plan.shortfallAmount, 10)
  assert.equal(plan.canSpend, false)
})

test("consumeWalletStationLocks depletes locks in created order and records each consumption", async () => {
  const queries = [
    [
      {
        id: 11,
        wallet_id: 7,
        user_id: 5,
        station_id: 3,
        station_public_id: "STN-001",
        station_name: "Limbe",
        source_transfer_id: 91,
        source_transfer_public_id: "WTR-001",
        currency_code: "MWK",
        original_amount_mwk: 70,
        amount_mwk_remaining: 70,
        status: "ACTIVE",
        metadata_json: null,
        depleted_at: null,
        expired_at: null,
        cancelled_at: null,
        created_at: new Date("2026-03-23T08:00:00.000Z"),
        updated_at: new Date("2026-03-23T08:00:00.000Z"),
      },
      {
        id: 12,
        wallet_id: 7,
        user_id: 5,
        station_id: 3,
        station_public_id: "STN-001",
        station_name: "Limbe",
        source_transfer_id: 92,
        source_transfer_public_id: "WTR-002",
        currency_code: "MWK",
        original_amount_mwk: 80,
        amount_mwk_remaining: 80,
        status: "ACTIVE",
        metadata_json: null,
        depleted_at: null,
        expired_at: null,
        cancelled_at: null,
        created_at: new Date("2026-03-23T08:05:00.000Z"),
        updated_at: new Date("2026-03-23T08:05:00.000Z"),
      },
    ],
  ]
  const executeCalls = []
  const db = {
    async $queryRaw() {
      if (!queries.length) {
        throw new Error("Unexpected $queryRaw call in walletStationLocks test.")
      }
      return queries.shift()
    },
    async $executeRaw(...args) {
      executeCalls.push(args)
      return 1
    },
  }

  const result = await consumeWalletStationLocks(db, {
    walletId: 7,
    stationId: 3,
    amountMwk: 120,
    currencyCode: "MWK",
    actorUserId: 5,
    ledgerTransactionId: 44,
    relatedEntityType: "QUEUE",
    relatedEntityId: "QUEUE-001",
    paymentReference: "WPM-LOCK-001",
  })

  assert.equal(result.consumedAmount, 120)
  assert.equal(result.items.length, 2)
  assert.deepEqual(
    result.items.map((item) => ({
      lockId: item.lockId,
      amountConsumed: item.amountConsumed,
      amountRemaining: item.amountRemaining,
      status: item.status,
    })),
    [
      {
        lockId: 11,
        amountConsumed: 70,
        amountRemaining: 0,
        status: "DEPLETED",
      },
      {
        lockId: 12,
        amountConsumed: 50,
        amountRemaining: 30,
        status: "ACTIVE",
      },
    ]
  )
  assert.equal(executeCalls.length, 4)
})

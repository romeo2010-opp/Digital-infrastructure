import test from "node:test"
import assert from "node:assert/strict"
import {
  assertWalletEligibleForQueuePrepay,
  buildSmartPayPrepayQuote,
} from "../modules/userQueue/routes.js"

test("buildSmartPayPrepayQuote charges only the direct-discounted amount for SmartPay prepay", () => {
  const quote = buildSmartPayPrepayQuote({
    pricing: {
      subtotal: 100000,
      totalDirectDiscount: 5000,
      cashback: 2000,
      finalPayable: 95000,
      effectiveNetCost: 93000,
      directPricePerLitre: 4750,
      effectivePricePerLitre: 4650,
      promoLabelsApplied: ["Flash Petrol Rush", "Wallet Boost Cashback"],
    },
    basePricePerLitre: 5000,
    litres: 20,
  })

  assert.equal(quote.subtotal, 100000)
  assert.equal(quote.totalDirectDiscount, 5000)
  assert.equal(quote.cashbackTotal, 2000)
  assert.equal(quote.estimatedAmount, 95000)
  assert.equal(quote.payablePricePerLitre, 4750)
  assert.equal(quote.effectiveNetCost, 93000)
  assert.deepEqual(quote.promoLabelsApplied, ["Flash Petrol Rush", "Wallet Boost Cashback"])
})

test("buildSmartPayPrepayQuote falls back to the base amount when no discount applies", () => {
  const quote = buildSmartPayPrepayQuote({
    pricing: {},
    basePricePerLitre: 4990,
    litres: 10,
  })

  assert.equal(quote.subtotal, 49900)
  assert.equal(quote.totalDirectDiscount, 0)
  assert.equal(quote.cashbackTotal, 0)
  assert.equal(quote.estimatedAmount, 49900)
  assert.equal(quote.payablePricePerLitre, 4990)
})

test("assertWalletEligibleForQueuePrepay allows active wallets", () => {
  assert.equal(assertWalletEligibleForQueuePrepay({ status: "ACTIVE" }), true)
})

test("assertWalletEligibleForQueuePrepay blocks frozen wallets", () => {
  assert.throws(
    () => assertWalletEligibleForQueuePrepay({ status: "SUSPENDED" }),
    /Wallet is frozen\. Queue prepay with wallet is unavailable until the wallet is unfrozen\./
  )
})

test("assertWalletEligibleForQueuePrepay blocks closed wallets", () => {
  assert.throws(
    () => assertWalletEligibleForQueuePrepay({ status: "CLOSED" }),
    /Wallet is closed\. Queue prepay with wallet is unavailable\./
  )
})

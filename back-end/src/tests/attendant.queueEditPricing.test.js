import test from "node:test"
import assert from "node:assert/strict"
import { deriveEditedQueueServiceRequestPricing } from "../modules/attendant/routes.js"

test("deriveEditedQueueServiceRequestPricing recalculates quoted request values from edited litres", () => {
  const result = deriveEditedQueueServiceRequestPricing({
    body: {
      requestedLitres: 25,
      fuelType: "petrol",
    },
    rawMetadata: {
      serviceRequest: {
        paymentMode: "PAY_AT_PUMP",
        fuelType: "PETROL",
        requestedLitres: 20,
        estimatedAmount: 100000,
      },
    },
    rowFuelCode: "PETROL",
    stationPricesJson: JSON.stringify([
      {
        label: "Petrol",
        price: 5000,
      },
    ]),
  })

  assert.equal(result.effectivePaymentMode, "PAY_AT_PUMP")
  assert.equal(result.requestedLitres, 25)
  assert.equal(result.requestedAmountMwk, 125000)
  assert.equal(result.estimatedAmountMwk, 125000)
  assert.equal(result.displayPricePerLitre, 5000)
  assert.equal(result.hasPaymentImpactChange, true)
})

test("deriveEditedQueueServiceRequestPricing uses SmartPay quote values as the payment authority", () => {
  const result = deriveEditedQueueServiceRequestPricing({
    body: {
      requestedLitres: 25,
      fuelType: "petrol",
    },
    rawMetadata: {
      serviceRequest: {
        paymentMode: "PREPAY",
        fuelType: "PETROL",
        requestedLitres: 20,
        estimatedAmount: 100000,
      },
    },
    rowFuelCode: "PETROL",
    stationPricesJson: JSON.stringify([
      {
        label: "Petrol",
        price: 5000,
      },
    ]),
    smartPayPricing: {
      subtotal: 125000,
      totalDirectDiscount: 6250,
      cashback: 2500,
      finalPayable: 118750,
      effectiveNetCost: 116250,
      directPricePerLitre: 4750,
      effectivePricePerLitre: 4650,
      promoLabelsApplied: ["SmartPay Wallet Discount"],
    },
  })

  assert.equal(result.effectivePaymentMode, "PREPAY")
  assert.equal(result.requestedLitres, 25)
  assert.equal(result.requestedAmountMwk, 125000)
  assert.equal(result.estimatedAmountMwk, 118750)
  assert.equal(result.displayPricePerLitre, 4750)
  assert.equal(result.smartPayQuote?.subtotal, 125000)
  assert.equal(result.smartPayQuote?.cashbackTotal, 2500)
  assert.deepEqual(result.smartPayQuote?.promoLabelsApplied, ["SmartPay Wallet Discount"])
  assert.equal(result.hasPaymentImpactChange, true)
})

test("deriveEditedQueueServiceRequestPricing derives litres automatically from an edited amount", () => {
  const result = deriveEditedQueueServiceRequestPricing({
    body: {
      amountMwk: 125000,
      fuelType: "petrol",
    },
    rawMetadata: {
      serviceRequest: {
        paymentMode: "PAY_AT_PUMP",
        fuelType: "PETROL",
        estimatedAmount: 100000,
      },
    },
    rowFuelCode: "PETROL",
    stationPricesJson: JSON.stringify([
      {
        label: "Petrol",
        price: 5000,
      },
    ]),
  })

  assert.equal(result.effectivePaymentMode, "PAY_AT_PUMP")
  assert.equal(result.requestedLitres, 25)
  assert.equal(result.requestedAmountMwk, 125000)
  assert.equal(result.estimatedAmountMwk, 125000)
  assert.equal(result.displayPricePerLitre, 5000)
  assert.equal(result.hasPaymentImpactChange, true)
})

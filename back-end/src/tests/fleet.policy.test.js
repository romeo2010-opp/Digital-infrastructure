import test from "node:test"
import assert from "node:assert/strict"
import {
  calculateFleetAllocationRollover,
  calculateFleetWalletAvailability,
  calculateFleetFinancialOpsMetrics,
  evaluateFleetPolicyChecks,
} from "../modules/fleet/service.js"

test("calculateFleetWalletAvailability prevents negative available spend", () => {
  const wallet = calculateFleetWalletAvailability({
    balance: 120000,
    reservedBalance: 30000,
  })

  assert.equal(wallet.balance, 120000)
  assert.equal(wallet.reservedBalance, 30000)
  assert.equal(wallet.availableBalance, 90000)
  assert.equal(wallet.canSpend(90000), true)
  assert.equal(wallet.canSpend(90001), false)
})

test("evaluateFleetPolicyChecks blocks limit violations", () => {
  const result = evaluateFleetPolicyChecks({
    policies: [
      {
        name: "Daily driver limit",
        dailyAmountLimit: 80000,
        monthlyLitreLimit: 300,
      },
    ],
    usage: {
      dailyAmount: 50000,
      monthlyLitres: 280,
    },
    request: {
      amount: 40000,
      litres: 30,
      fuelType: "diesel",
    },
  })

  assert.equal(result.allowed, false)
  assert.equal(result.status, "blocked")
  assert.match(result.checks[0].messages.join(" "), /Daily amount limit exceeded/)
})

test("evaluateFleetPolicyChecks returns warning for approval threshold", () => {
  const result = evaluateFleetPolicyChecks({
    policies: [
      {
        name: "Approval threshold",
        requiresApprovalAboveAmount: 50000,
      },
    ],
    usage: {},
    request: {
      amount: 65000,
      litres: 20,
      fuelType: "petrol",
    },
  })

  assert.equal(result.allowed, true)
  assert.equal(result.status, "warning")
  assert.match(result.checks[0].messages.join(" "), /Approval required/)
})

test("evaluateFleetPolicyChecks enforces fuel and station restrictions", () => {
  const result = evaluateFleetPolicyChecks({
    policies: [
      {
        name: "Diesel-only depot",
        allowedFuelType: "diesel",
        allowedStationIds: ["STATION-1"],
      },
    ],
    usage: {},
    request: {
      amount: 10000,
      litres: 10,
      fuelType: "petrol",
      stationPublicId: "STATION-2",
    },
  })

  assert.equal(result.allowed, false)
  assert.equal(result.status, "blocked")
  assert.equal(result.checks[0].messages.length, 2)
})

test("calculateFleetFinancialOpsMetrics computes cost per km and budget variance", () => {
  const metrics = calculateFleetFinancialOpsMetrics({
    monthlyFuelCost: 720000,
    monthlyKm: 4800,
    budget: {
      fuelBudget: 900000,
      maintenanceBudget: 200000,
      otherBudget: 100000,
    },
    invoices: {
      pending: 250000,
      overdue: 100000,
      paid: 500000,
    },
  })

  assert.equal(metrics.costPerKm, 150)
  assert.equal(metrics.totalBudget, 1200000)
  assert.equal(metrics.budgetVariance, 480000)
  assert.equal(metrics.budgetVarianceStatus, "within_budget")
  assert.equal(metrics.invoiceTotals.outstanding, 350000)
})

test("calculateFleetFinancialOpsMetrics flags over-budget fuel spend", () => {
  const metrics = calculateFleetFinancialOpsMetrics({
    monthlyFuelCost: 1500000,
    monthlyKm: 0,
    budget: {
      fuelBudget: 1000000,
      maintenanceBudget: 100000,
      otherBudget: 100000,
    },
  })

  assert.equal(metrics.costPerKm, 0)
  assert.equal(metrics.budgetVariance, -300000)
  assert.equal(metrics.budgetVarianceStatus, "over_budget")
})

test("calculateFleetAllocationRollover supports top-up-to-cap", () => {
  const preview = calculateFleetAllocationRollover({
    publicId: "ALLOC-1",
    rolloverPolicy: "top_up_to_cap",
    monthlyLitreCap: 500,
    currentLitreBalance: 200,
    monthlyMoneyCap: 750000,
    currentMoneyBalance: 300000,
  }, { periodStart: "2026-06-01", periodEnd: "2026-06-30" })

  assert.equal(preview.topUpLitres, 300)
  assert.equal(preview.newLitreBalance, 500)
  assert.equal(preview.topUpAmount, 450000)
  assert.equal(preview.requiresManualReview, false)
})

test("calculateFleetAllocationRollover supports reset and capped carry-over", () => {
  const reset = calculateFleetAllocationRollover({
    rollover_policy: "reset_no_carryover",
    monthly_litre_cap: 120,
    current_litre_balance: 40,
  })
  assert.equal(reset.topUpLitres, 120)
  assert.equal(reset.newLitreBalance, 120)

  const carry = calculateFleetAllocationRollover({
    rollover_policy: "carryover_with_cap",
    monthly_litre_cap: 100,
    current_litre_balance: 80,
    max_carryover_litres: 150,
  })
  assert.equal(carry.topUpLitres, 70)
  assert.equal(carry.newLitreBalance, 150)
})

test("calculateFleetAllocationRollover flags manual review", () => {
  const manual = calculateFleetAllocationRollover({
    rollover_policy: "manual_review",
    monthly_litre_cap: 100,
    current_litre_balance: 25,
  })
  assert.equal(manual.requiresManualReview, true)
  assert.equal(manual.topUpLitres, 75)
})

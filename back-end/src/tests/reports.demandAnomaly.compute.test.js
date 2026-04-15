import test from "node:test"
import assert from "node:assert/strict"
import { computeDemandAnomalySignal } from "../modules/reports/demandAnomaly.compute.js"

test("returns WARNING at z-score warning boundary", () => {
  const signal = computeDemandAnomalySignal(
    {
      currentVelocityLph: 117.7,
      currentTxRateTph: 10,
      baselineVelocitySeries: [90, 100, 110, 100, 100],
      baselineTxSeries: [8, 10, 9, 11, 10],
      ewmaVelocitySeries: [100, 100, 100, 100, 100],
    },
    {
      warningZ: 2.5,
      criticalZ: 3.5,
    }
  )

  assert.equal(signal.severity, "WARNING")
  assert.ok(signal.zScore >= 2.5 && signal.zScore < 3.5)
})

test("returns CRITICAL at z-score critical boundary", () => {
  const signal = computeDemandAnomalySignal(
    {
      currentVelocityLph: 135,
      currentTxRateTph: 10,
      baselineVelocitySeries: [90, 100, 110, 100, 100],
      baselineTxSeries: [8, 10, 9, 11, 10],
    },
    {
      warningZ: 2.5,
      criticalZ: 3.5,
    }
  )

  assert.equal(signal.severity, "CRITICAL")
  assert.ok(signal.zScore >= 3.5)
})

test("returns NONE when scores are below thresholds", () => {
  const signal = computeDemandAnomalySignal(
    {
      currentVelocityLph: 108,
      currentTxRateTph: 10,
      baselineVelocitySeries: [95, 100, 105, 99, 101],
      baselineTxSeries: [9, 10, 10, 11, 9],
      ewmaVelocitySeries: [100, 100, 100, 100, 100],
    },
    {
      warningZ: 2.5,
      criticalZ: 3.5,
    }
  )

  assert.equal(signal.severity, "NONE")
  assert.ok(signal.detectionScore < 2.5)
})

test("EWMA shift can trigger warning even when z-score is below threshold", () => {
  const signal = computeDemandAnomalySignal(
    {
      currentVelocityLph: 120,
      currentTxRateTph: 9,
      baselineVelocitySeries: [80, 120, 100, 100, 100],
      baselineTxSeries: [8, 9, 9, 10, 9],
      ewmaVelocitySeries: [70, 72, 74, 76, 78],
    },
    {
      warningZ: 2.5,
      criticalZ: 3.5,
      ewmaAlpha: 0.2,
    }
  )

  assert.ok(signal.zScore < 2.5)
  assert.ok(signal.ewmaShiftScore >= 2.5)
  assert.equal(signal.severity, "WARNING")
  assert.ok(signal.rulesTriggered.includes("ewma_shift"))
})

test("CUSUM alerts are enabled only when feature flag is on", () => {
  const baseInputs = {
    currentVelocityLph: 130,
    currentTxRateTph: 8,
    baselineVelocitySeries: [100, 100, 100, 100, 100],
    baselineTxSeries: [8, 8, 8, 8, 8],
    ewmaVelocitySeries: [100, 100, 100, 100],
    cusumVelocitySeries: [100, 100, 100, 100],
  }

  const withoutCusum = computeDemandAnomalySignal(baseInputs, {
    warningZ: 2.5,
    criticalZ: 3.5,
    enableCusum: false,
  })
  const withCusum = computeDemandAnomalySignal(baseInputs, {
    warningZ: 2.5,
    criticalZ: 3.5,
    enableCusum: true,
  })

  assert.equal(withoutCusum.severity, "NONE")
  assert.equal(withoutCusum.cusumValue, null)
  assert.equal(withCusum.severity, "CRITICAL")
  assert.ok(withCusum.rulesTriggered.includes("cusum_shift"))
})

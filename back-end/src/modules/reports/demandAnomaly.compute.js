const VALID_SEVERITIES = new Set(["NONE", "WARNING", "CRITICAL"])

export const DEFAULT_DEMAND_ANOMALY_CONFIG = Object.freeze({
  warningZ: 2.5,
  criticalZ: 3.5,
  ewmaAlpha: 0.2,
  enableCusum: false,
  cusumThreshold: 5,
  cusumDriftK: 0.5,
})

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === "bigint") {
    const converted = Number(value)
    return Number.isFinite(converted) ? converted : fallback
  }
  const normalized =
    typeof value === "string"
      ? value
      : typeof value?.toString === "function"
        ? value.toString()
        : value
  const numeric = Number.parseFloat(String(normalized))
  return Number.isFinite(numeric) ? numeric : fallback
}

function toPositiveNumber(value, fallback) {
  const numeric = toFiniteNumber(value, fallback)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return numeric
}

function normalizeFraction(value, fallback) {
  const numeric = toFiniteNumber(value, fallback)
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 1) return fallback
  return numeric
}

function normalizeConfig(overrides = {}) {
  const warningZ = toPositiveNumber(overrides.warningZ, DEFAULT_DEMAND_ANOMALY_CONFIG.warningZ)
  const criticalZRaw = toPositiveNumber(overrides.criticalZ, DEFAULT_DEMAND_ANOMALY_CONFIG.criticalZ)
  const criticalZ = Math.max(criticalZRaw, warningZ)

  return {
    warningZ,
    criticalZ,
    ewmaAlpha: normalizeFraction(overrides.ewmaAlpha, DEFAULT_DEMAND_ANOMALY_CONFIG.ewmaAlpha),
    enableCusum: Boolean(
      overrides.enableCusum !== undefined
        ? overrides.enableCusum
        : DEFAULT_DEMAND_ANOMALY_CONFIG.enableCusum
    ),
    cusumThreshold: toPositiveNumber(
      overrides.cusumThreshold,
      DEFAULT_DEMAND_ANOMALY_CONFIG.cusumThreshold
    ),
    cusumDriftK: toPositiveNumber(overrides.cusumDriftK, DEFAULT_DEMAND_ANOMALY_CONFIG.cusumDriftK),
  }
}

function cleanSeries(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
}

function computeMeanStd(values = []) {
  if (!values.length) return { mean: 0, std: 0, count: 0 }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (values.length < 2) return { mean, std: 0, count: values.length }
  const variance =
    values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1)
  return {
    mean,
    std: Math.sqrt(Math.max(variance, 0)),
    count: values.length,
  }
}

function scoreFromDeviation({ value, mean, std }) {
  const delta = value - mean
  if (!Number.isFinite(delta) || delta <= 0) return 0
  const denominator = std > 0 ? std : Math.max(Math.abs(mean) * 0.15, 1)
  return delta / denominator
}

function computeEwmaBaseline(series = [], alpha = DEFAULT_DEMAND_ANOMALY_CONFIG.ewmaAlpha) {
  if (!series.length) return null
  let ewma = series[0]
  for (let index = 1; index < series.length; index += 1) {
    ewma = (alpha * series[index]) + ((1 - alpha) * ewma)
  }
  return ewma
}

function computeCusum({ history = [], currentValue = 0, mean = 0, std = 0, config }) {
  if (!config.enableCusum) {
    return { cusumValue: null, cusumScore: 0 }
  }

  const series = [...history, currentValue].filter((value) => Number.isFinite(value))
  if (!series.length) {
    return { cusumValue: 0, cusumScore: 0 }
  }

  const driftK = Math.max(config.cusumDriftK * Math.max(std, 1), 1)
  let cusum = 0
  for (const value of series) {
    cusum = Math.max(0, cusum + (value - mean - driftK))
  }

  const cusumScore = std > 0 ? cusum / std : (cusum > 0 ? config.criticalZ + 1 : 0)
  return {
    cusumValue: cusum,
    cusumScore,
  }
}

function resolveSeverity(score, config) {
  if (!Number.isFinite(score) || score < config.warningZ) return "NONE"
  if (score >= config.criticalZ) return "CRITICAL"
  return "WARNING"
}

function uniq(values = []) {
  return Array.from(new Set(values.filter(Boolean)))
}

export function computeDemandAnomalySignal(inputs = {}, configOverrides = {}) {
  const config = normalizeConfig(configOverrides)
  const currentVelocityLph = toFiniteNumber(inputs.currentVelocityLph, 0)
  const currentTxRateTph = toFiniteNumber(inputs.currentTxRateTph, 0)

  const velocitySeries = cleanSeries(inputs.baselineVelocitySeries)
  const txSeries = cleanSeries(inputs.baselineTxSeries)
  const ewmaSeries = cleanSeries(inputs.ewmaVelocitySeries || velocitySeries)
  const cusumSeries = cleanSeries(inputs.cusumVelocitySeries || ewmaSeries)

  const velocityStats = computeMeanStd(velocitySeries)
  const txStats = computeMeanStd(txSeries)

  const zScore = scoreFromDeviation({
    value: currentVelocityLph,
    mean: velocityStats.mean,
    std: velocityStats.std,
  })
  const txZScore = scoreFromDeviation({
    value: currentTxRateTph,
    mean: txStats.mean,
    std: txStats.std,
  })

  const ewmaBaseline = computeEwmaBaseline(ewmaSeries, config.ewmaAlpha)
  const ewmaValue =
    ewmaBaseline === null
      ? currentVelocityLph
      : (config.ewmaAlpha * currentVelocityLph) + ((1 - config.ewmaAlpha) * ewmaBaseline)
  const ewmaShiftScore =
    ewmaBaseline === null
      ? 0
      : scoreFromDeviation({
          value: currentVelocityLph,
          mean: ewmaBaseline,
          std: velocityStats.std,
        })

  const { cusumValue, cusumScore } = computeCusum({
    history: cusumSeries,
    currentValue: currentVelocityLph,
    mean: velocityStats.mean,
    std: velocityStats.std,
    config,
  })

  const detectionScore = Math.max(zScore, txZScore, ewmaShiftScore, cusumScore)
  const severity = resolveSeverity(detectionScore, config)

  const rulesTriggered = uniq([
    zScore >= config.warningZ ? "z_score_velocity" : null,
    txZScore >= config.warningZ ? "z_score_transactions" : null,
    ewmaShiftScore >= config.warningZ ? "ewma_shift" : null,
    config.enableCusum && cusumScore >= config.warningZ ? "cusum_shift" : null,
  ])

  const result = {
    severity,
    detectionScore,
    currentVelocityLph,
    currentTxRateTph,
    expectedMeanLph: velocityStats.mean,
    expectedStdLph: velocityStats.std,
    expectedMeanTph: txStats.mean,
    expectedStdTph: txStats.std,
    zScore,
    txZScore,
    ewmaValue,
    ewmaBaseline,
    ewmaShiftScore,
    cusumValue,
    cusumScore,
    rulesTriggered,
    baselineCount: velocityStats.count,
  }

  if (!VALID_SEVERITIES.has(result.severity)) {
    return { ...result, severity: "NONE" }
  }

  return result
}

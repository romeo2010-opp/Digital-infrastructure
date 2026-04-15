const GUARANTEE_STATES = new Set(["safe", "warning", "critical", "none"])

export const DEFAULT_FUEL_GUARANTEE_CONFIG = {
  defaultAvgLitersPerCarPetrol: 25,
  defaultAvgLitersPerCarDiesel: 30,
  safetyBufferMinLiters: 150,
  safetyBufferPct: 0.05,
  safeExtraMarginPct: 0.1,
  stalenessSeconds: 120,
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric
}

function normalizePositive(value, fallback) {
  const numeric = toFiniteNumberOrNull(value)
  if (numeric === null || numeric <= 0) return fallback
  return numeric
}

function normalizeFraction(value, fallback) {
  const numeric = toFiniteNumberOrNull(value)
  if (numeric === null || numeric < 0) return fallback
  return numeric
}

function normalizeIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function ensureState(value, fallback = "none") {
  const scoped = String(value || "").trim().toLowerCase()
  return GUARANTEE_STATES.has(scoped) ? scoped : fallback
}

function downgradeState(value) {
  const state = ensureState(value)
  if (state === "safe") return "warning"
  if (state === "warning") return "critical"
  if (state === "critical") return "none"
  return "none"
}

function pushNote(notes, value) {
  if (!value) return
  if (!notes.includes(value)) notes.push(value)
}

function normalizeUnknownSeverity(value) {
  const scoped = String(value || "").trim().toLowerCase()
  if (scoped === "very_uncertain") return "very_uncertain"
  return "moderate"
}

function normalizeConfig(overrides = {}) {
  return {
    defaultAvgLitersPerCarPetrol: normalizePositive(
      overrides.defaultAvgLitersPerCarPetrol,
      DEFAULT_FUEL_GUARANTEE_CONFIG.defaultAvgLitersPerCarPetrol
    ),
    defaultAvgLitersPerCarDiesel: normalizePositive(
      overrides.defaultAvgLitersPerCarDiesel,
      DEFAULT_FUEL_GUARANTEE_CONFIG.defaultAvgLitersPerCarDiesel
    ),
    safetyBufferMinLiters: normalizePositive(
      overrides.safetyBufferMinLiters,
      DEFAULT_FUEL_GUARANTEE_CONFIG.safetyBufferMinLiters
    ),
    safetyBufferPct: normalizeFraction(
      overrides.safetyBufferPct,
      DEFAULT_FUEL_GUARANTEE_CONFIG.safetyBufferPct
    ),
    safeExtraMarginPct: normalizeFraction(
      overrides.safeExtraMarginPct,
      DEFAULT_FUEL_GUARANTEE_CONFIG.safeExtraMarginPct
    ),
    stalenessSeconds: normalizePositive(
      overrides.stalenessSeconds,
      DEFAULT_FUEL_GUARANTEE_CONFIG.stalenessSeconds
    ),
  }
}

export function computeFuelGuarantee(inputs = {}, configOverrides = {}) {
  const config = normalizeConfig(configOverrides)
  const notes = Array.isArray(inputs.notes)
    ? inputs.notes.map((item) => String(item || "").trim()).filter(Boolean)
    : []

  const nowDate = inputs.now instanceof Date ? inputs.now : new Date(inputs.now || Date.now())
  const nowMs = Number.isNaN(nowDate.getTime()) ? Date.now() : nowDate.getTime()

  const carsAhead = Math.max(0, Number(inputs.carsAhead || 0))
  let avgLitersPerCarUsed = toFiniteNumberOrNull(inputs.avgLitersPerCar)
  let requestedLitersUsed = toFiniteNumberOrNull(inputs.requestedLiters)

  const cap = toFiniteNumberOrNull(inputs.maxLitersPerCarCap)
  if (cap !== null && cap > 0) {
    if (avgLitersPerCarUsed !== null) avgLitersPerCarUsed = Math.min(avgLitersPerCarUsed, cap)
    if (requestedLitersUsed !== null) requestedLitersUsed = Math.min(requestedLitersUsed, cap)
    pushNote(notes, "ration_cap_applied")
  }

  if (avgLitersPerCarUsed === null || avgLitersPerCarUsed <= 0) {
    avgLitersPerCarUsed = null
    pushNote(notes, "avg_litres_unknown")
  }

  if (requestedLitersUsed === null || requestedLitersUsed <= 0) {
    requestedLitersUsed = avgLitersPerCarUsed
  }

  const fuelRemainingLiters = toFiniteNumberOrNull(inputs.fuelRemainingLiters)
  const effectiveFuelLitersInput = toFiniteNumberOrNull(inputs.effectiveFuelLiters)
  const effectiveFuelLiters =
    effectiveFuelLitersInput !== null
      ? effectiveFuelLitersInput
      : fuelRemainingLiters

  const fuelLastUpdatedAt = normalizeIsoOrNull(inputs.fuelLastUpdatedAt)
  const fuelLastUpdatedMs = fuelLastUpdatedAt ? new Date(fuelLastUpdatedAt).getTime() : NaN
  const fuelDataStale =
    !Number.isFinite(fuelLastUpdatedMs) ||
    nowMs - fuelLastUpdatedMs > config.stalenessSeconds * 1000

  if (inputs.refillBoostApplied) {
    pushNote(notes, "refill_boost_applied")
  }

  let state = "none"
  let litersBeforeYou = null
  let litersToCoverYou = null
  let safetyBufferLitersUsed = null
  let usesUnknownFuelData = false

  if (fuelRemainingLiters === null || effectiveFuelLiters === null || avgLitersPerCarUsed === null || requestedLitersUsed === null) {
    usesUnknownFuelData = true
    pushNote(notes, "fuel_data_missing")
    state = normalizeUnknownSeverity(inputs.unknownSeverity) === "very_uncertain" ? "none" : "warning"
  } else {
    safetyBufferLitersUsed = Math.max(
      config.safetyBufferMinLiters,
      effectiveFuelLiters * config.safetyBufferPct
    )
    litersBeforeYou = carsAhead * avgLitersPerCarUsed
    litersToCoverYou = litersBeforeYou + requestedLitersUsed + safetyBufferLitersUsed

    if (effectiveFuelLiters >= litersToCoverYou * (1 + config.safeExtraMarginPct)) {
      state = "safe"
    } else if (effectiveFuelLiters >= litersToCoverYou) {
      state = "warning"
    } else if (effectiveFuelLiters >= litersBeforeYou + safetyBufferLitersUsed) {
      state = "critical"
    } else {
      state = "none"
    }
  }

  if (fuelDataStale && !usesUnknownFuelData) {
    const downgradedState = downgradeState(state)
    if (downgradedState !== state) {
      state = downgradedState
      pushNote(notes, "fuel_data_stale_downgrade")
    }
  }

  return {
    state,
    fuelRemainingLiters,
    effectiveFuelLiters,
    litersBeforeYou,
    litersToCoverYou,
    requestedLitersUsed,
    avgLitersPerCarUsed,
    safetyBufferLitersUsed,
    fuelLastUpdatedAt,
    fuelDataStale,
    avgSource: inputs.avgSource || null,
    notes,
  }
}

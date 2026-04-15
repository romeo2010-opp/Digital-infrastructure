import test from "node:test"
import assert from "node:assert/strict"
import {
  STATION_PLAN_CODES,
  STATION_PLAN_FEATURES,
  getStationPlanDefinition,
  hasStationPlanFeature,
} from "../modules/subscriptions/planCatalog.js"

test("trial plan keeps operational features locked", () => {
  const trial = getStationPlanDefinition(STATION_PLAN_CODES.TRIAL)

  assert.equal(trial.name, "Trial Plan")
  assert.equal(hasStationPlanFeature(trial.code, STATION_PLAN_FEATURES.DIGITAL_QUEUE), false)
  assert.equal(hasStationPlanFeature(trial.code, STATION_PLAN_FEATURES.INSIGHTS), false)
})

test("growth plan unlocks operations but not enterprise analytics", () => {
  assert.equal(hasStationPlanFeature(STATION_PLAN_CODES.GROWTH, STATION_PLAN_FEATURES.RESERVATIONS), true)
  assert.equal(hasStationPlanFeature(STATION_PLAN_CODES.GROWTH, STATION_PLAN_FEATURES.MONITORING), true)
  assert.equal(hasStationPlanFeature(STATION_PLAN_CODES.GROWTH, STATION_PLAN_FEATURES.INSIGHTS), false)
})

test("enterprise plan unlocks insights and exports", () => {
  assert.equal(hasStationPlanFeature(STATION_PLAN_CODES.ENTERPRISE, STATION_PLAN_FEATURES.INSIGHTS), true)
  assert.equal(hasStationPlanFeature(STATION_PLAN_CODES.ENTERPRISE, STATION_PLAN_FEATURES.REPORTS_EXPORT), true)
})

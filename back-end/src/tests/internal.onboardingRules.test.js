import test from "node:test"
import assert from "node:assert/strict"
import {
  canActivateCompletedOnboarding,
  deriveBackfilledOnboardingStatus,
  normalizeOnboardingStatus,
} from "../modules/internal/onboardingRules.js"

test("normalizeOnboardingStatus uppercases and trims values", () => {
  assert.equal(normalizeOnboardingStatus(" review "), "REVIEW")
  assert.equal(normalizeOnboardingStatus(null), "")
})

test("canActivateCompletedOnboarding allows completed onboarding workflow states", () => {
  assert.equal(canActivateCompletedOnboarding("SUBMITTED"), true)
  assert.equal(canActivateCompletedOnboarding("REVIEW"), true)
  assert.equal(canActivateCompletedOnboarding("READY_FOR_ACTIVATION"), true)
  assert.equal(canActivateCompletedOnboarding("ACTIVATED"), true)
})

test("canActivateCompletedOnboarding blocks missing or terminal non-activation states", () => {
  assert.equal(canActivateCompletedOnboarding(""), false)
  assert.equal(canActivateCompletedOnboarding("REJECTED"), false)
  assert.equal(canActivateCompletedOnboarding("NOT_STARTED"), false)
})

test("deriveBackfilledOnboardingStatus uses active flag first", () => {
  assert.equal(
    deriveBackfilledOnboardingStatus({ isActive: true, pendingChecklistItems: ["STAFF_ASSIGNMENTS"] }),
    "ACTIVATED"
  )
})

test("deriveBackfilledOnboardingStatus maps pending checklist state to workflow status", () => {
  assert.equal(deriveBackfilledOnboardingStatus({ isActive: false, pendingChecklistItems: [] }), "READY_FOR_ACTIVATION")
  assert.equal(
    deriveBackfilledOnboardingStatus({ isActive: false, pendingChecklistItems: ["PUMP_AND_NOZZLE_SETUP"] }),
    "REVIEW"
  )
})

const ACTIVATABLE_ONBOARDING_STATUSES = new Set([
  "SUBMITTED",
  "REVIEW",
  "READY_FOR_ACTIVATION",
  "ACTIVATED",
])

export function normalizeOnboardingStatus(status) {
  return String(status || "").trim().toUpperCase()
}

export function canActivateCompletedOnboarding(status) {
  return ACTIVATABLE_ONBOARDING_STATUSES.has(normalizeOnboardingStatus(status))
}

export function deriveBackfilledOnboardingStatus({ isActive = false, pendingChecklistItems = [] } = {}) {
  if (Boolean(isActive)) return "ACTIVATED"
  return Array.isArray(pendingChecklistItems) && pendingChecklistItems.length ? "REVIEW" : "READY_FOR_ACTIVATION"
}

import {
  buildStationPlanUpgradeMessage,
  getStationSubscriptionSummary,
  hasStationPlanFeature,
} from "./planCatalog.js"

export function requireStationPlanFeature(featureKey) {
  return async function stationPlanFeatureGuard(req, res, next) {
    const stationId = Number(req.auth?.stationId || 0)
    if (!Number.isFinite(stationId) || stationId <= 0) {
      return next()
    }

    const subscription = await getStationSubscriptionSummary(stationId)
    if (hasStationPlanFeature(subscription?.planCode, featureKey)) {
      return next()
    }

    return res.status(403).json({
      ok: false,
      error: buildStationPlanUpgradeMessage(featureKey, subscription),
    })
  }
}

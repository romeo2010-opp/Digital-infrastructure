import { useMemo } from "react"
import { useAuth } from "../auth/AuthContext"
import {
  formatPlanPrice,
  getFeatureRequirement,
  getSessionStationPlan,
  hasStationPlanFeature,
} from "./planCatalog"

export function useStationPlan() {
  const { session } = useAuth()

  return useMemo(() => {
    const plan = getSessionStationPlan(session)

    return {
      ...plan,
      priceLabel: formatPlanPrice(plan.monthlyFeeMwk),
      hasFeature(featureKey) {
        return hasStationPlanFeature(plan.planCode, featureKey)
      },
      getRequirement(featureKey) {
        return getFeatureRequirement(featureKey)
      },
    }
  }, [session])
}

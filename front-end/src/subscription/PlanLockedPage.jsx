import Navbar from "../components/Navbar"
import { formatPlanPrice } from "./planCatalog"
import { useStationPlan } from "./useStationPlan"
import "../features/settings/settings.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

export default function PlanLockedPage({ title = "Feature Locked", featureName, requiredPlan }) {
  const currentPlan = useStationPlan()
  const requirement = requiredPlan || currentPlan.getRequirement?.()

  return (
    <div className="settings-page">
      <Navbar pagetitle={title} image={avatar} count={0} />
      <section className="settings-shell">
        <article className="settings-card">
          <h3>{featureName || title}</h3>
          <p className="settings-error" style={{ marginBottom: "16px" }}>
            {featureName || "This feature"} is not available on {currentPlan.planName}. Upgrade to {requirement?.name || "a higher plan"} to unlock it.
          </p>
          <div className="settings-grid">
            <label>
              Current Plan
              <input value={`${currentPlan.planName} · ${currentPlan.priceLabel}`} disabled />
            </label>
            <label>
              Required Plan
              <input
                value={`${requirement?.name || "Higher plan"} · ${formatPlanPrice(requirement?.monthlyFeeMwk || 0)}`}
                disabled
              />
            </label>
          </div>
          <p className="settings-muted" style={{ marginTop: "12px" }}>
            Contact SmartLink internal support or your platform owner to change this station subscription.
          </p>
        </article>
      </section>
    </div>
  )
}

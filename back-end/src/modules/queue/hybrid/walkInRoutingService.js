import { PumpState } from "./domain.js"

function rankPumpForWalkIn(left, right) {
  const leftBusy = Number(left?.committedVehicleCount || 0)
  const rightBusy = Number(right?.committedVehicleCount || 0)
  if (leftBusy !== rightBusy) return leftBusy - rightBusy

  const leftIdleBoost = left?.state === PumpState.IDLE ? -1 : 0
  const rightIdleBoost = right?.state === PumpState.IDLE ? -1 : 0
  if (leftIdleBoost !== rightIdleBoost) return leftIdleBoost - rightIdleBoost

  return String(left?.id || "").localeCompare(String(right?.id || ""))
}

export class WalkInRoutingService {
  constructor({ policy }) {
    this.policy = policy
  }

  routeNewWalkIn({ walkInJob, pumps = [], queueJobs = [] }) {
    const compatiblePumps = pumps
      .filter((pump) => this.policy.resolveWalkInPumpAvailability(pump, queueJobs))
      .filter((pump) => this.policy.isCompatiblePumpJob(pump, walkInJob))
      .sort(rankPumpForWalkIn)

    const selectedPump = compatiblePumps[0] || null
    if (selectedPump) {
      return {
        selectedPump,
        redirectMessage:
          selectedPump.mode === "DIGITAL_PRIORITY"
            ? null
            : "Proceed to the assigned pump lane.",
      }
    }

    const offlineOnly = pumps.every((pump) => pump.state === PumpState.OFFLINE)
    return {
      selectedPump: null,
      redirectMessage: offlineOnly
        ? "No pumps are available right now."
        : this.policy.config.kioskWalkInRedirectMessage,
    }
  }
}

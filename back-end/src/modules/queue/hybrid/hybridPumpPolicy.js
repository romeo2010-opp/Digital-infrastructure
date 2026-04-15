import {
  PaymentStatus,
  PumpQueueState,
  QueueJobSource,
  QueueJobState,
  compareJobsByPriority,
  isCompatibleFuel,
  isDigitalSource,
  isTerminalQueueJobState,
} from "./domain.js"

const DEFAULT_PRIORITY_CONFIG = Object.freeze({
  readyDigitalPrepaid: 1000,
  readyDigital: 900,
  readyReservation: 780,
  readyWalkIn: 620,
  waitingWalkIn: 580,
  calledDigital: 950,
  missedCallPenalty: 120,
})

export class HybridPumpPolicy {
  constructor(config = {}) {
    this.config = {
      digitalHoldTimeoutMs: Number(config.digitalHoldTimeoutMs || 120000),
      kioskWalkInRedirectMessage:
        String(config.kioskWalkInRedirectMessage || "").trim()
        || "Pilot pump reserved for next ready SmartLink user. Please use another pump.",
      priority: {
        ...DEFAULT_PRIORITY_CONFIG,
        ...(config.priority || {}),
      },
    }
  }

  isPilotPump(pump) {
    return pump?.mode === "DIGITAL_PRIORITY"
  }

  isCompatiblePumpJob(pump, job) {
    if (!pump || !job) return false
    if (pump.state === "OFFLINE") return false
    return isCompatibleFuel(pump, job.fuelType)
  }

  isDigitalSource(source) {
    return isDigitalSource(source)
  }

  isReadyDigitalJob(job, pump) {
    if (!this.isDigitalSource(job?.source)) return false
    if (job?.state !== QueueJobState.READY_ON_SITE) return false
    if (isTerminalQueueJobState(job?.state)) return false
    return this.isCompatiblePumpJob(pump, job)
  }

  isDispatchableWalkIn(job, pump) {
    if (job?.source !== QueueJobSource.WALK_IN) return false
    if (isTerminalQueueJobState(job?.state)) return false
    if (![QueueJobState.WAITING, QueueJobState.READY_ON_SITE].includes(job?.state)) return false
    return this.isCompatiblePumpJob(pump, job)
  }

  scoreJob(job) {
    if (!job) return 0

    let baseScore = 0
    if (job.state === QueueJobState.CALLED && this.isDigitalSource(job.source)) {
      baseScore = this.config.priority.calledDigital
    } else if (
      this.isDigitalSource(job.source)
      && job.state === QueueJobState.READY_ON_SITE
      && job.source !== QueueJobSource.RESERVATION
    ) {
      baseScore =
        job.paymentStatus === PaymentStatus.PAID
        || job.paymentStatus === PaymentStatus.PREAUTHORIZED
          ? this.config.priority.readyDigitalPrepaid
          : this.config.priority.readyDigital
    } else if (
      job.source === QueueJobSource.RESERVATION
      && job.state === QueueJobState.READY_ON_SITE
    ) {
      baseScore = this.config.priority.readyReservation
    } else if (
      job.source === QueueJobSource.WALK_IN
      && job.state === QueueJobState.READY_ON_SITE
    ) {
      baseScore = this.config.priority.readyWalkIn
    } else if (
      job.source === QueueJobSource.WALK_IN
      && job.state === QueueJobState.WAITING
    ) {
      baseScore = this.config.priority.waitingWalkIn
    }

    const missPenalty = Number(job.missCount || 0) * this.config.priority.missedCallPenalty
    return baseScore - missPenalty
  }

  scoreJobs(queueJobs = []) {
    return queueJobs
      .map((job) => ({
        ...job,
        priorityScore: this.scoreJob(job),
      }))
      .sort(compareJobsByPriority)
  }

  getReadyDigitalJobs(queueJobs = [], pump) {
    return this.scoreJobs(queueJobs).filter((job) => this.isReadyDigitalJob(job, pump))
  }

  hasReadyDigitalDemand(queueJobs = [], pump) {
    return this.getReadyDigitalJobs(queueJobs, pump).length > 0
  }

  resolveWalkInPumpAvailability(pump, queueJobs = []) {
    if (!pump) return false
    if (pump.state === "OFFLINE") return false
    if (
      this.isPilotPump(pump)
      && (
        pump.queueState === PumpQueueState.DIGITAL_HOLD
        || this.hasReadyDigitalDemand(queueJobs, pump)
      )
    ) {
      return false
    }
    return true
  }
}

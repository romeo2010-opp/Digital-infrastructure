import {
  PumpQueueState,
  PumpState,
  QueueJobState,
  cloneLaneCommitment,
  clonePump,
  cloneQueueJob,
  findAssignedDigitalCall,
  findQueueJob,
  getActiveLaneCommitmentsForPump,
  isDigitalSource,
  recalculateCommittedVehicleCount,
  toIsoString,
} from "./domain.js"

function releaseHold(pump, { preserveState = false } = {}) {
  return {
    ...pump,
    queueState: PumpQueueState.OPEN_TO_WALKINS,
    holdStartedAt: null,
    holdExpiresAt: null,
    state: preserveState ? pump.state : pump.state === PumpState.OFFLINE ? PumpState.OFFLINE : pump.state,
  }
}

export class PumpDispatcher {
  constructor({ policy }) {
    this.policy = policy
  }

  dispatchPilotPump({ pilotPump, queueJobs = [], laneCommitments = [], now = new Date() }) {
    const timestamp = toIsoString(now)
    let pump = clonePump(pilotPump)
    let nextQueueJobs = queueJobs.map(cloneQueueJob)
    const nextLaneCommitments = laneCommitments.map(cloneLaneCommitment)

    if (pump.state === PumpState.OFFLINE) {
      return this.handlePumpOffline({
        pilotPump: pump,
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        now: timestamp,
      })
    }

    nextQueueJobs = this.policy.scoreJobs(nextQueueJobs)
    const committedBlockers = getActiveLaneCommitmentsForPump(pump.id, nextLaneCommitments, nextQueueJobs)
    const activeCalledJob = findAssignedDigitalCall(nextQueueJobs, pump.id)
    const readyDigitalJobs = this.policy.getReadyDigitalJobs(nextQueueJobs, pump)
    const selectedDigitalJob = activeCalledJob || readyDigitalJobs[0] || null

    pump = {
      ...pump,
      committedVehicleCount: recalculateCommittedVehicleCount(pump, nextLaneCommitments, nextQueueJobs),
    }

    if (!selectedDigitalJob) {
      return {
        pump: releaseHold(pump),
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        decision: {
          type: "OPEN_TO_WALKINS",
          reason: "no_ready_digital_user",
          targetJobId: null,
          committedBlockers: committedBlockers.length,
        },
      }
    }

    pump = {
      ...pump,
      queueState: PumpQueueState.DIGITAL_HOLD,
      holdStartedAt: pump.holdStartedAt || timestamp,
    }

    if (pump.state === PumpState.FUELING) {
      return {
        pump,
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        decision: {
          type: "HOLD_FOR_NEXT_SLOT",
          reason: "pump_is_currently_fueling",
          targetJobId: selectedDigitalJob.id,
          committedBlockers: committedBlockers.length,
        },
      }
    }

    const hasCommittedBlockers = committedBlockers.length > 0
    if (hasCommittedBlockers) {
      return {
        pump: {
          ...pump,
          currentAssignmentId: pump.currentAssignmentId || committedBlockers[0].queueJobId,
          state: pump.state === PumpState.IDLE ? PumpState.RESERVED : pump.state,
        },
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        decision: {
          type: "WAIT_FOR_COMMITTED_LANE_CLEARANCE",
          reason: "committed_lane_blockers_remain",
          targetJobId: selectedDigitalJob.id,
          committedBlockers: committedBlockers.length,
        },
      }
    }

    if (activeCalledJob) {
      return {
        pump: {
          ...pump,
          state: PumpState.RESERVED,
          currentAssignmentId: activeCalledJob.id,
        },
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        decision: {
          type: "WAIT_FOR_CALLED_DIGITAL_APPROACH",
          reason: "slot_already_reserved_for_selected_digital",
          targetJobId: activeCalledJob.id,
          committedBlockers: 0,
        },
      }
    }

    nextQueueJobs = nextQueueJobs.map((job) => {
      if (job.id !== selectedDigitalJob.id) return job
      return {
        ...job,
        state: QueueJobState.CALLED,
        calledAt: timestamp,
        assignedPumpId: pump.id,
      }
    })

    return {
      pump: {
        ...pump,
        state: PumpState.RESERVED,
        currentAssignmentId: selectedDigitalJob.id,
        holdExpiresAt: new Date(
          new Date(timestamp).getTime() + this.policy.config.digitalHoldTimeoutMs
        ).toISOString(),
      },
      queueJobs: this.policy.scoreJobs(nextQueueJobs),
      laneCommitments: nextLaneCommitments,
      decision: {
        type: "CALL_READY_DIGITAL_USER",
        reason: "pilot_pump_became_controllable",
        targetJobId: selectedDigitalJob.id,
        committedBlockers: 0,
      },
    }
  }

  processTimeouts({ pilotPump, queueJobs = [], laneCommitments = [], now = new Date() }) {
    const timestamp = toIsoString(now)
    let pump = clonePump(pilotPump)
    let nextQueueJobs = queueJobs.map(cloneQueueJob)
    const nextLaneCommitments = laneCommitments.map(cloneLaneCommitment)

    if (pump.state === PumpState.OFFLINE) {
      return this.handlePumpOffline({
        pilotPump: pump,
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        now: timestamp,
      })
    }

    const holdExpiresAt = pump.holdExpiresAt ? new Date(pump.holdExpiresAt).getTime() : NaN
    const nowMs = new Date(timestamp).getTime()
    if (
      pump.queueState !== PumpQueueState.DIGITAL_HOLD
      || !Number.isFinite(holdExpiresAt)
      || holdExpiresAt > nowMs
    ) {
      return {
        pump,
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
        decision: {
          type: "NO_TIMEOUT_ACTION",
          reason: "hold_not_expired",
          targetJobId: pump.currentAssignmentId || null,
        },
      }
    }

    const timedOutJob = findAssignedDigitalCall(nextQueueJobs, pump.id)
      || findQueueJob(nextQueueJobs, pump.currentAssignmentId)

    if (timedOutJob && isDigitalSource(timedOutJob.source) && !timedOutJob.isCommittedToLane) {
      nextQueueJobs = nextQueueJobs.map((job) => {
        if (job.id !== timedOutJob.id) return job
        return {
          ...job,
          state: QueueJobState.MISSED_CALL,
          missCount: Number(job.missCount || 0) + 1,
          assignedPumpId: null,
          priorityScore: 0,
        }
      })
    }

    const remainingCommitments = getActiveLaneCommitmentsForPump(
      pump.id,
      nextLaneCommitments,
      nextQueueJobs
    )

    pump = {
      ...releaseHold({
        ...pump,
        currentAssignmentId: remainingCommitments[0]?.queueJobId || null,
        state: remainingCommitments.length ? PumpState.RESERVED : PumpState.IDLE,
      }),
      committedVehicleCount: recalculateCommittedVehicleCount(pump, nextLaneCommitments, nextQueueJobs),
    }

    return {
      pump,
      queueJobs: this.policy.scoreJobs(nextQueueJobs),
      laneCommitments: nextLaneCommitments,
      decision: {
        type: "RELEASE_HOLD_AFTER_TIMEOUT",
        reason: "selected_digital_user_missed_call_window",
        targetJobId: timedOutJob?.id || null,
      },
    }
  }

  handlePumpOffline({ pilotPump, queueJobs = [], laneCommitments = [], now = new Date() }) {
    const timestamp = toIsoString(now)
    const pump = clonePump(pilotPump)
    const nextLaneCommitments = laneCommitments.map(cloneLaneCommitment)
    const nextQueueJobs = this.policy.scoreJobs(
      queueJobs.map((job) => {
        if (job.assignedPumpId !== pump.id) return cloneQueueJob(job)
        if (!isDigitalSource(job.source)) return cloneQueueJob(job)
        if (job.isCommittedToLane) return cloneQueueJob(job)
        if (job.state !== QueueJobState.CALLED && job.state !== QueueJobState.ASSIGNED) {
          return cloneQueueJob(job)
        }
        return {
          ...job,
          state: QueueJobState.READY_ON_SITE,
          calledAt: null,
          assignedPumpId: null,
          readyAt: job.readyAt || timestamp,
        }
      })
    )

    return {
      pump: {
        ...releaseHold({
          ...pump,
          currentAssignmentId: null,
          state: PumpState.OFFLINE,
        }),
        committedVehicleCount: recalculateCommittedVehicleCount(pump, nextLaneCommitments, nextQueueJobs),
      },
      queueJobs: nextQueueJobs,
      laneCommitments: nextLaneCommitments,
      decision: {
        type: "RELEASE_HOLD_PUMP_OFFLINE",
        reason: "pilot_pump_offline",
        targetJobId: pump.currentAssignmentId || null,
      },
    }
  }
}

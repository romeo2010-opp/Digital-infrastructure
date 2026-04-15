import { HybridPumpPolicy } from "./hybridPumpPolicy.js"
import { PumpDispatcher } from "./pumpDispatcher.js"
import { ReadinessService } from "./readinessService.js"
import { WalkInRoutingService } from "./walkInRoutingService.js"
import {
  LaneCommitmentStatus,
  PumpMode,
  PumpQueueState,
  PumpState,
  QueueJobState,
  buildLaneCommitmentId,
  cloneLaneCommitment,
  clonePump,
  cloneQueueJob,
  findAssignedDigitalCall,
  findQueueJob,
  getActiveLaneCommitmentsForPump,
  mapDigitalUserStatus,
  recalculateCommittedVehicleCount,
  resolveCommittedCarsAheadForTarget,
  toIsoString,
} from "./domain.js"

export class QueueEngine {
  constructor(config = {}) {
    this.policy = config.policy || new HybridPumpPolicy(config)
    this.readinessService = config.readinessService || new ReadinessService()
    this.walkInRoutingService =
      config.walkInRoutingService || new WalkInRoutingService({ policy: this.policy })
    this.pumpDispatcher = config.pumpDispatcher || new PumpDispatcher({ policy: this.policy })
  }

  getReadinessChannels() {
    return this.readinessService.getSupportedSignals()
  }

  scoreJobs(queueJobs = []) {
    return this.policy.scoreJobs(queueJobs)
  }

  applyReadinessSignal({ queueJobs = [], jobId, signalType, occurredAt, metadata }) {
    const result = this.readinessService.applySignal({
      queueJobs,
      jobId,
      signalType,
      occurredAt,
      metadata,
    })

    return {
      ...result,
      queueJobs: this.policy.scoreJobs(result.queueJobs),
    }
  }

  dispatchPilotPump(params) {
    const result = this.pumpDispatcher.dispatchPilotPump(params)
    return {
      ...result,
      kioskState: this.buildKioskState({
        pilotPump: result.pump,
        queueJobs: result.queueJobs,
        laneCommitments: result.laneCommitments,
      }),
    }
  }

  processTimeouts(params) {
    const result = this.pumpDispatcher.processTimeouts(params)
    return {
      ...result,
      kioskState: this.buildKioskState({
        pilotPump: result.pump,
        queueJobs: result.queueJobs,
        laneCommitments: result.laneCommitments,
      }),
    }
  }

  handlePumpOffline(params) {
    const result = this.pumpDispatcher.handlePumpOffline(params)
    return {
      ...result,
      kioskState: this.buildKioskState({
        pilotPump: result.pump,
        queueJobs: result.queueJobs,
        laneCommitments: result.laneCommitments,
      }),
    }
  }

  routeWalkIn({ walkInJob, pumps = [], queueJobs = [], laneCommitments = [], now = new Date() }) {
    const timestamp = toIsoString(now)
    const nextPumps = pumps.map(clonePump)
    let nextQueueJobs = queueJobs.map(cloneQueueJob)
    const nextLaneCommitments = laneCommitments.map(cloneLaneCommitment)

    if (!nextQueueJobs.some((job) => job.id === walkInJob.id)) {
      nextQueueJobs.push(cloneQueueJob(walkInJob))
    }

    const routingDecision = this.walkInRoutingService.routeNewWalkIn({
      walkInJob,
      pumps: nextPumps,
      queueJobs: nextQueueJobs,
    })

    if (!routingDecision.selectedPump) {
      return {
        pumps: nextPumps,
        queueJobs: this.policy.scoreJobs(nextQueueJobs),
        laneCommitments: nextLaneCommitments,
        selectedPumpId: null,
        decision: {
          type: "NO_WALK_IN_PUMP_AVAILABLE",
          redirectMessage: routingDecision.redirectMessage,
        },
      }
    }

    const selectedPumpId = routingDecision.selectedPump.id
    nextQueueJobs = this.policy.scoreJobs(
      nextQueueJobs.map((job) => {
        if (job.id !== walkInJob.id) return job
        return {
          ...job,
          state: QueueJobState.ASSIGNED,
          readyAt: job.readyAt || timestamp,
          assignedPumpId: selectedPumpId,
          isCommittedToLane: true,
        }
      })
    )

    const alreadyCommitted = nextLaneCommitments.some(
      (commitment) =>
        commitment.pumpId === selectedPumpId
        && commitment.queueJobId === walkInJob.id
        && commitment.status === LaneCommitmentStatus.COMMITTED
    )

    if (!alreadyCommitted) {
      nextLaneCommitments.push({
        id: buildLaneCommitmentId(selectedPumpId, walkInJob.id, timestamp),
        pumpId: selectedPumpId,
        queueJobId: walkInJob.id,
        committedAt: timestamp,
        status: LaneCommitmentStatus.COMMITTED,
      })
    }

    const updatedPumps = nextPumps.map((pump) => {
      if (pump.id !== selectedPumpId) return pump
      const committedVehicleCount = recalculateCommittedVehicleCount(
        pump,
        nextLaneCommitments,
        nextQueueJobs
      )
      const hasOpenAssignment = !pump.currentAssignmentId
      return {
        ...pump,
        currentAssignmentId: hasOpenAssignment ? walkInJob.id : pump.currentAssignmentId,
        state:
          pump.state === PumpState.IDLE && hasOpenAssignment
            ? PumpState.RESERVED
            : pump.state,
        committedVehicleCount,
      }
    })

    return {
      pumps: updatedPumps,
      queueJobs: nextQueueJobs,
      laneCommitments: nextLaneCommitments,
      selectedPumpId,
      decision: {
        type: "WALK_IN_ROUTED",
        redirectMessage: routingDecision.redirectMessage,
      },
    }
  }

  markLaneCommitted({ pump, queueJobs = [], laneCommitments = [], queueJobId, now = new Date() }) {
    const timestamp = toIsoString(now)
    let nextQueueJobs = queueJobs.map((job) => {
      if (job.id !== queueJobId) return cloneQueueJob(job)
      return {
        ...job,
        state: QueueJobState.ASSIGNED,
        assignedPumpId: pump.id,
        isCommittedToLane: true,
      }
    })

    const nextLaneCommitments = laneCommitments.map(cloneLaneCommitment)
    const existingCommitment = nextLaneCommitments.find(
      (commitment) =>
        commitment.pumpId === pump.id
        && commitment.queueJobId === queueJobId
        && commitment.status === LaneCommitmentStatus.COMMITTED
    )

    if (!existingCommitment) {
      nextLaneCommitments.push({
        id: buildLaneCommitmentId(pump.id, queueJobId, timestamp),
        pumpId: pump.id,
        queueJobId,
        committedAt: timestamp,
        status: LaneCommitmentStatus.COMMITTED,
      })
    }

    nextQueueJobs = this.policy.scoreJobs(nextQueueJobs)

    return {
      pump: {
        ...clonePump(pump),
        currentAssignmentId: queueJobId,
        state: PumpState.RESERVED,
        committedVehicleCount: recalculateCommittedVehicleCount(
          pump,
          nextLaneCommitments,
          nextQueueJobs
        ),
      },
      queueJobs: nextQueueJobs,
      laneCommitments: nextLaneCommitments,
    }
  }

  startFueling({ pump, queueJobs = [], laneCommitments = [], queueJobId, now = new Date() }) {
    const committed = this.markLaneCommitted({
      pump,
      queueJobs,
      laneCommitments,
      queueJobId,
      now,
    })

    return {
      pump: {
        ...committed.pump,
        state: PumpState.FUELING,
      },
      queueJobs: this.policy.scoreJobs(
        committed.queueJobs.map((job) => {
          if (job.id !== queueJobId) return job
          return {
            ...job,
            state: QueueJobState.FUELING,
          }
        })
      ),
      laneCommitments: committed.laneCommitments,
    }
  }

  completeFueling({ pump, queueJobs = [], laneCommitments = [], queueJobId }) {
    let nextQueueJobs = queueJobs.map((job) => {
      if (job.id !== queueJobId) return cloneQueueJob(job)
      return {
        ...job,
        state: QueueJobState.COMPLETED,
        isCommittedToLane: false,
      }
    })

    const nextLaneCommitments = laneCommitments.map((commitment) => {
      if (commitment.queueJobId !== queueJobId) return cloneLaneCommitment(commitment)
      return {
        ...commitment,
        status: LaneCommitmentStatus.CLEARED,
      }
    })

    nextQueueJobs = this.policy.scoreJobs(nextQueueJobs)
    const remainingCommitments = getActiveLaneCommitmentsForPump(
      pump.id,
      nextLaneCommitments,
      nextQueueJobs
    )

    const clearedPump = {
      ...clonePump(pump),
      currentAssignmentId: remainingCommitments[0]?.queueJobId || null,
      state: remainingCommitments.length ? PumpState.RESERVED : PumpState.IDLE,
      committedVehicleCount: remainingCommitments.length,
    }

    if (clearedPump.mode === PumpMode.DIGITAL_PRIORITY) {
      const redispatched = this.pumpDispatcher.dispatchPilotPump({
        pilotPump: clearedPump,
        queueJobs: nextQueueJobs,
        laneCommitments: nextLaneCommitments,
      })

      return {
        ...redispatched,
        kioskState: this.buildKioskState({
          pilotPump: redispatched.pump,
          queueJobs: redispatched.queueJobs,
          laneCommitments: redispatched.laneCommitments,
        }),
      }
    }

    return {
      pump: clearedPump,
      queueJobs: nextQueueJobs,
      laneCommitments: nextLaneCommitments,
    }
  }

  buildKioskState({ pilotPump, queueJobs = [], laneCommitments = [] }) {
    const scoredJobs = this.policy.scoreJobs(queueJobs)
    const activeCommitments = getActiveLaneCommitmentsForPump(
      pilotPump.id,
      laneCommitments,
      scoredJobs
    )
    const assignedDigitalCall = findAssignedDigitalCall(scoredJobs, pilotPump.id)
    const nextReadyDigitalJob = this.policy.getReadyDigitalJobs(scoredJobs, pilotPump)[0] || null
    const currentAssignment = findQueueJob(scoredJobs, pilotPump.currentAssignmentId)
    const nextAssignmentTarget =
      assignedDigitalCall
      || (
        pilotPump.queueState === PumpQueueState.DIGITAL_HOLD
          ? nextReadyDigitalJob || currentAssignment
          : currentAssignment || nextReadyDigitalJob
      )
    const committedCarsAhead =
      nextAssignmentTarget && !nextAssignmentTarget.assignedPumpId && nextAssignmentTarget.state === QueueJobState.READY_ON_SITE
        ? activeCommitments.length
        : nextAssignmentTarget
          ? resolveCommittedCarsAheadForTarget(nextAssignmentTarget, laneCommitments, scoredJobs)
          : activeCommitments.length

    return {
      pilotPumpId: pilotPump.id,
      pilotPumpMode: pilotPump.mode,
      pilotPumpState: pilotPump.state,
      pilotPumpQueueState: pilotPump.queueState,
      digitalHoldActive: pilotPump.queueState === PumpQueueState.DIGITAL_HOLD,
      committedCarsAhead,
      currentNextAssignmentTarget: nextAssignmentTarget
        ? {
            jobId: nextAssignmentTarget.id,
            source: nextAssignmentTarget.source,
            state: nextAssignmentTarget.state,
            fuelType: nextAssignmentTarget.fuelType,
            priorityScore: nextAssignmentTarget.priorityScore,
          }
        : null,
      walkInRedirectMessage:
        pilotPump.queueState === PumpQueueState.DIGITAL_HOLD
          ? this.policy.config.kioskWalkInRedirectMessage
          : null,
      digitalUserStatuses: scoredJobs
        .filter((job) => this.policy.isDigitalSource(job.source))
        .map((job) => ({
          jobId: job.id,
          status: mapDigitalUserStatus(job),
          pumpId: job.assignedPumpId,
          priorityScore: job.priorityScore,
        })),
    }
  }
}

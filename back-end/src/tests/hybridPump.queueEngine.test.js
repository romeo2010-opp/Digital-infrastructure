import test from "node:test"
import assert from "node:assert/strict"
import {
  PaymentStatus,
  PumpMode,
  PumpQueueState,
  PumpState,
  QueueJobSource,
  QueueJobState,
  QueueEngine,
  ReadinessSignalType,
} from "../modules/queue/hybrid/index.js"

function makePump(overrides = {}) {
  return {
    id: "P01",
    name: "Pilot Pump",
    fuelTypesSupported: ["PETROL"],
    mode: PumpMode.DIGITAL_PRIORITY,
    state: PumpState.IDLE,
    queueState: PumpQueueState.OPEN_TO_WALKINS,
    committedVehicleCount: 0,
    currentAssignmentId: null,
    holdStartedAt: null,
    holdExpiresAt: null,
    ...overrides,
  }
}

function makeStandardPump(id, overrides = {}) {
  return {
    id,
    name: `Pump ${id}`,
    fuelTypesSupported: ["PETROL", "DIESEL"],
    mode: PumpMode.NORMAL,
    state: PumpState.IDLE,
    queueState: PumpQueueState.OPEN_TO_WALKINS,
    committedVehicleCount: 0,
    currentAssignmentId: null,
    holdStartedAt: null,
    holdExpiresAt: null,
    ...overrides,
  }
}

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    source: QueueJobSource.WALK_IN,
    state: QueueJobState.WAITING,
    customerId: null,
    fuelType: "PETROL",
    requestedVolumeLitres: null,
    paymentStatus: PaymentStatus.UNPAID,
    joinedAt: "2026-04-02T07:55:00.000Z",
    calledAt: null,
    readyAt: null,
    assignedPumpId: null,
    isCommittedToLane: false,
    priorityScore: 0,
    missCount: 0,
    ...overrides,
  }
}

function makeCommitment(overrides = {}) {
  return {
    id: "LC-1",
    pumpId: "P01",
    queueJobId: "job-1",
    committedAt: "2026-04-02T07:56:00.000Z",
    status: "COMMITTED",
    ...overrides,
  }
}

test("no digital user ready means the pilot pump accepts a walk-in", () => {
  const engine = new QueueEngine()
  const pilotPump = makePump()
  const standardPump = makeStandardPump("P02")
  const remoteDigital = makeJob({
    id: "digital-remote",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.WAITING,
  })
  const walkIn = makeJob({ id: "walk-in-1" })

  const dispatch = engine.dispatchPilotPump({
    pilotPump,
    queueJobs: [remoteDigital],
    laneCommitments: [],
    now: "2026-04-02T08:00:00.000Z",
  })

  assert.equal(dispatch.decision.type, "OPEN_TO_WALKINS")
  assert.equal(dispatch.kioskState.digitalHoldActive, false)

  const routed = engine.routeWalkIn({
    walkInJob: walkIn,
    pumps: [pilotPump, standardPump],
    queueJobs: [remoteDigital],
    laneCommitments: [],
    now: "2026-04-02T08:00:05.000Z",
  })

  assert.equal(routed.selectedPumpId, pilotPump.id)
  assert.equal(routed.queueJobs.find((job) => job.id === "walk-in-1")?.assignedPumpId, pilotPump.id)
})

test("a ready digital user during fueling activates hold for the next slot only", () => {
  const engine = new QueueEngine()
  const fuelingWalkIn = makeJob({
    id: "walk-fueling",
    source: QueueJobSource.WALK_IN,
    state: QueueJobState.FUELING,
    assignedPumpId: "P01",
    isCommittedToLane: true,
  })
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:00:00.000Z",
  })

  const result = engine.dispatchPilotPump({
    pilotPump: makePump({
      state: PumpState.FUELING,
      currentAssignmentId: fuelingWalkIn.id,
      committedVehicleCount: 1,
    }),
    queueJobs: [fuelingWalkIn, readyDigital],
    laneCommitments: [makeCommitment({ queueJobId: fuelingWalkIn.id })],
    now: "2026-04-02T08:01:00.000Z",
  })

  assert.equal(result.pump.queueState, PumpQueueState.DIGITAL_HOLD)
  assert.equal(result.pump.state, PumpState.FUELING)
  assert.equal(result.pump.currentAssignmentId, fuelingWalkIn.id)
  assert.equal(result.decision.type, "HOLD_FOR_NEXT_SLOT")
  assert.equal(result.decision.targetJobId, readyDigital.id)
  assert.equal(result.queueJobs.find((job) => job.id === readyDigital.id)?.state, QueueJobState.READY_ON_SITE)
})

test("committed walk-ins ahead stay in place and new walk-ins are routed away during hold", () => {
  const engine = new QueueEngine()
  const pilotPump = makePump()
  const standardPump = makeStandardPump("P02")
  const walkAheadOne = makeJob({
    id: "walk-ahead-1",
    source: QueueJobSource.WALK_IN,
    state: QueueJobState.ASSIGNED,
    assignedPumpId: pilotPump.id,
    isCommittedToLane: true,
  })
  const walkAheadTwo = makeJob({
    id: "walk-ahead-2",
    source: QueueJobSource.WALK_IN,
    state: QueueJobState.ASSIGNED,
    assignedPumpId: pilotPump.id,
    isCommittedToLane: true,
  })
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:02:00.000Z",
  })

  const dispatched = engine.dispatchPilotPump({
    pilotPump,
    queueJobs: [walkAheadOne, walkAheadTwo, readyDigital],
    laneCommitments: [
      makeCommitment({ id: "LC-1", queueJobId: walkAheadOne.id, committedAt: "2026-04-02T08:00:00.000Z" }),
      makeCommitment({ id: "LC-2", queueJobId: walkAheadTwo.id, committedAt: "2026-04-02T08:01:00.000Z" }),
    ],
    now: "2026-04-02T08:03:00.000Z",
  })

  assert.equal(dispatched.decision.type, "WAIT_FOR_COMMITTED_LANE_CLEARANCE")
  assert.equal(dispatched.pump.queueState, PumpQueueState.DIGITAL_HOLD)
  assert.equal(dispatched.pump.currentAssignmentId, walkAheadOne.id)
  assert.equal(dispatched.kioskState.committedCarsAhead, 2)

  const routed = engine.routeWalkIn({
    walkInJob: makeJob({ id: "walk-new" }),
    pumps: [dispatched.pump, standardPump],
    queueJobs: dispatched.queueJobs,
    laneCommitments: dispatched.laneCommitments,
    now: "2026-04-02T08:03:10.000Z",
  })

  assert.equal(routed.selectedPumpId, standardPump.id)
  assert.equal(
    routed.laneCommitments.filter((commitment) => commitment.pumpId === pilotPump.id).length,
    2
  )
})

test("endless new walk-ins arriving during hold are all routed away from the pilot", () => {
  const engine = new QueueEngine()
  const pilotPump = makePump({
    queueState: PumpQueueState.DIGITAL_HOLD,
    holdStartedAt: "2026-04-02T08:04:00.000Z",
  })
  const standardPump = makeStandardPump("P02")
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:04:00.000Z",
  })

  let pumps = [pilotPump, standardPump]
  let queueJobs = [readyDigital]
  let laneCommitments = []

  for (const id of ["walk-1", "walk-2", "walk-3"]) {
    const routed = engine.routeWalkIn({
      walkInJob: makeJob({ id }),
      pumps,
      queueJobs,
      laneCommitments,
      now: "2026-04-02T08:04:30.000Z",
    })

    assert.equal(routed.selectedPumpId, standardPump.id)
    pumps = routed.pumps
    queueJobs = routed.queueJobs
    laneCommitments = routed.laneCommitments
  }

  assert.equal(
    laneCommitments.some((commitment) => commitment.pumpId === pilotPump.id && commitment.queueJobId === "walk-3"),
    false
  )
})

test("a missed digital timeout releases hold and lets walk-ins resume on the pilot", () => {
  const engine = new QueueEngine({ digitalHoldTimeoutMs: 30000 })
  const pilotPump = makePump()
  const standardPump = makeStandardPump("P02")
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:05:00.000Z",
  })

  const dispatched = engine.dispatchPilotPump({
    pilotPump,
    queueJobs: [readyDigital],
    laneCommitments: [],
    now: "2026-04-02T08:05:00.000Z",
  })

  assert.equal(dispatched.decision.type, "CALL_READY_DIGITAL_USER")
  assert.equal(dispatched.pump.queueState, PumpQueueState.DIGITAL_HOLD)
  assert.equal(dispatched.queueJobs.find((job) => job.id === readyDigital.id)?.state, QueueJobState.CALLED)

  const timedOut = engine.processTimeouts({
    pilotPump: dispatched.pump,
    queueJobs: dispatched.queueJobs,
    laneCommitments: [],
    now: "2026-04-02T08:06:00.000Z",
  })

  assert.equal(timedOut.decision.type, "RELEASE_HOLD_AFTER_TIMEOUT")
  assert.equal(timedOut.pump.queueState, PumpQueueState.OPEN_TO_WALKINS)
  assert.equal(timedOut.pump.state, PumpState.IDLE)
  assert.equal(
    timedOut.queueJobs.find((job) => job.id === readyDigital.id)?.state,
    QueueJobState.MISSED_CALL
  )

  const routed = engine.routeWalkIn({
    walkInJob: makeJob({ id: "walk-resume" }),
    pumps: [timedOut.pump, standardPump],
    queueJobs: timedOut.queueJobs,
    laneCommitments: timedOut.laneCommitments,
    now: "2026-04-02T08:06:05.000Z",
  })

  assert.equal(routed.selectedPumpId, pilotPump.id)
})

test("when two digital users are ready the highest-priority one gets the next slot", () => {
  const engine = new QueueEngine()
  const prepaidDigital = makeJob({
    id: "digital-prepaid",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    paymentStatus: PaymentStatus.PREAUTHORIZED,
    readyAt: "2026-04-02T08:07:00.000Z",
  })
  const unpaidDigital = makeJob({
    id: "digital-unpaid",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    paymentStatus: PaymentStatus.UNPAID,
    readyAt: "2026-04-02T08:06:30.000Z",
  })

  const result = engine.dispatchPilotPump({
    pilotPump: makePump(),
    queueJobs: [unpaidDigital, prepaidDigital],
    laneCommitments: [],
    now: "2026-04-02T08:07:30.000Z",
  })

  assert.equal(result.decision.targetJobId, prepaidDigital.id)
  assert.equal(result.pump.currentAssignmentId, prepaidDigital.id)
  assert.equal(
    result.queueJobs.find((job) => job.id === prepaidDigital.id)?.state,
    QueueJobState.CALLED
  )
})

test("a remotely joined digital user who is not on site does not block the pilot pump", () => {
  const engine = new QueueEngine()
  const remoteDigital = makeJob({
    id: "digital-remote",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.WAITING,
  })

  const dispatch = engine.dispatchPilotPump({
    pilotPump: makePump(),
    queueJobs: [remoteDigital],
    laneCommitments: [],
    now: "2026-04-02T08:08:00.000Z",
  })

  assert.equal(dispatch.decision.type, "OPEN_TO_WALKINS")
  assert.equal(dispatch.kioskState.digitalHoldActive, false)

  const readiness = engine.applyReadinessSignal({
    queueJobs: [remoteDigital],
    jobId: remoteDigital.id,
    signalType: ReadinessSignalType.QR_SCAN,
    occurredAt: "2026-04-02T08:08:10.000Z",
  })

  assert.equal(readiness.updatedJob?.state, QueueJobState.READY_ON_SITE)
})

test("fuel type mismatches keep incompatible digital jobs from being assigned", () => {
  const engine = new QueueEngine()
  const incompatibleDigital = makeJob({
    id: "digital-diesel",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    fuelType: "DIESEL",
    readyAt: "2026-04-02T08:09:00.000Z",
  })

  const result = engine.dispatchPilotPump({
    pilotPump: makePump({ fuelTypesSupported: ["PETROL"] }),
    queueJobs: [incompatibleDigital],
    laneCommitments: [],
    now: "2026-04-02T08:09:30.000Z",
  })

  assert.equal(result.decision.type, "OPEN_TO_WALKINS")
  assert.equal(result.pump.currentAssignmentId, null)
})

test("if the pilot pump goes offline during hold the selected digital job is safely requeued", () => {
  const engine = new QueueEngine()
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:10:00.000Z",
  })

  const dispatched = engine.dispatchPilotPump({
    pilotPump: makePump(),
    queueJobs: [readyDigital],
    laneCommitments: [],
    now: "2026-04-02T08:10:05.000Z",
  })

  const offline = engine.handlePumpOffline({
    pilotPump: {
      ...dispatched.pump,
      state: PumpState.OFFLINE,
    },
    queueJobs: dispatched.queueJobs,
    laneCommitments: dispatched.laneCommitments,
    now: "2026-04-02T08:10:10.000Z",
  })

  assert.equal(offline.decision.type, "RELEASE_HOLD_PUMP_OFFLINE")
  assert.equal(offline.pump.queueState, PumpQueueState.OPEN_TO_WALKINS)
  assert.equal(offline.pump.state, PumpState.OFFLINE)
  assert.equal(
    offline.queueJobs.find((job) => job.id === readyDigital.id)?.state,
    QueueJobState.READY_ON_SITE
  )
  assert.equal(offline.queueJobs.find((job) => job.id === readyDigital.id)?.assignedPumpId, null)
})

test("a walk-in already committed to the pilot lane is never removed when digital hold activates", () => {
  const engine = new QueueEngine()
  const pilotPump = makePump()
  const walkIn = makeJob({ id: "walk-committed" })
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:11:00.000Z",
  })

  const routed = engine.routeWalkIn({
    walkInJob: walkIn,
    pumps: [pilotPump, makeStandardPump("P02")],
    queueJobs: [],
    laneCommitments: [],
    now: "2026-04-02T08:10:30.000Z",
  })

  const updatedPilotPump = routed.pumps.find((pump) => pump.id === pilotPump.id)
  const dispatched = engine.dispatchPilotPump({
    pilotPump: updatedPilotPump,
    queueJobs: [...routed.queueJobs, readyDigital],
    laneCommitments: routed.laneCommitments,
    now: "2026-04-02T08:11:05.000Z",
  })

  const committedWalkIn = dispatched.queueJobs.find((job) => job.id === walkIn.id)
  const commitment = dispatched.laneCommitments.find((item) => item.queueJobId === walkIn.id)

  assert.equal(dispatched.decision.type, "WAIT_FOR_COMMITTED_LANE_CLEARANCE")
  assert.equal(committedWalkIn?.isCommittedToLane, true)
  assert.equal(committedWalkIn?.state, QueueJobState.ASSIGNED)
  assert.equal(commitment?.status, "COMMITTED")
})

test("queue engine exposes all supported readiness channels", () => {
  const engine = new QueueEngine()
  const channels = engine.getReadinessChannels()

  assert.deepEqual(
    channels.map((item) => item.type),
    [
      ReadinessSignalType.ATTENDANT_KIOSK,
      ReadinessSignalType.QR_SCAN,
      ReadinessSignalType.BLE_NFC,
      ReadinessSignalType.GEOFENCE,
    ]
  )
})

test("startFueling commits the lane and moves the selected job into fueling", () => {
  const engine = new QueueEngine()
  const pilotPump = makePump()
  const readyDigital = makeJob({
    id: "digital-ready",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    readyAt: "2026-04-02T08:12:00.000Z",
  })

  const started = engine.startFueling({
    pump: pilotPump,
    queueJobs: [readyDigital],
    laneCommitments: [],
    queueJobId: readyDigital.id,
    now: "2026-04-02T08:12:10.000Z",
  })

  assert.equal(started.pump.state, PumpState.FUELING)
  assert.equal(started.pump.currentAssignmentId, readyDigital.id)
  assert.equal(started.queueJobs.find((job) => job.id === readyDigital.id)?.state, QueueJobState.FUELING)
  assert.equal(
    started.laneCommitments.some(
      (commitment) =>
        commitment.queueJobId === readyDigital.id
        && commitment.pumpId === pilotPump.id
        && commitment.status === "COMMITTED"
    ),
    true
  )
})

test("completeFueling clears the active commitment and releases the pump when no queue remains", () => {
  const engine = new QueueEngine()
  const fuelingDigital = makeJob({
    id: "digital-fueling",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.FUELING,
    assignedPumpId: "P01",
    isCommittedToLane: true,
  })

  const completed = engine.completeFueling({
    pump: makePump({
      state: PumpState.FUELING,
      currentAssignmentId: fuelingDigital.id,
      committedVehicleCount: 1,
    }),
    queueJobs: [fuelingDigital],
    laneCommitments: [makeCommitment({ queueJobId: fuelingDigital.id })],
    queueJobId: fuelingDigital.id,
  })

  assert.equal(completed.pump.state, PumpState.IDLE)
  assert.equal(completed.pump.currentAssignmentId, null)
  assert.equal(
    completed.queueJobs.find((job) => job.id === fuelingDigital.id)?.state,
    QueueJobState.COMPLETED
  )
  assert.equal(
    completed.laneCommitments.find((commitment) => commitment.queueJobId === fuelingDigital.id)?.status,
    "CLEARED"
  )
})

test("completeFueling immediately calls the next ready SmartLink user for the pilot pump", () => {
  const engine = new QueueEngine()
  const fuelingDigital = makeJob({
    id: "digital-fueling",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.FUELING,
    assignedPumpId: "P01",
    isCommittedToLane: true,
    readyAt: "2026-04-02T08:10:00.000Z",
  })
  const nextReadyDigital = makeJob({
    id: "digital-next",
    source: QueueJobSource.DIGITAL_QUEUE,
    state: QueueJobState.READY_ON_SITE,
    paymentStatus: PaymentStatus.PREAUTHORIZED,
    readyAt: "2026-04-02T08:11:00.000Z",
  })

  const completed = engine.completeFueling({
    pump: makePump({
      state: PumpState.FUELING,
      queueState: PumpQueueState.DIGITAL_HOLD,
      currentAssignmentId: fuelingDigital.id,
      holdStartedAt: "2026-04-02T08:10:00.000Z",
      holdExpiresAt: "2026-04-02T08:12:00.000Z",
      committedVehicleCount: 1,
    }),
    queueJobs: [fuelingDigital, nextReadyDigital],
    laneCommitments: [makeCommitment({ queueJobId: fuelingDigital.id })],
    queueJobId: fuelingDigital.id,
  })

  assert.equal(completed.pump.queueState, PumpQueueState.DIGITAL_HOLD)
  assert.equal(completed.pump.state, PumpState.RESERVED)
  assert.equal(completed.pump.currentAssignmentId, nextReadyDigital.id)
  assert.equal(completed.decision?.type, "CALL_READY_DIGITAL_USER")
  assert.equal(
    completed.queueJobs.find((job) => job.id === nextReadyDigital.id)?.state,
    QueueJobState.CALLED
  )
  assert.equal(completed.kioskState?.digitalHoldActive, true)
  assert.equal(completed.kioskState?.currentNextAssignmentTarget?.jobId, nextReadyDigital.id)
})

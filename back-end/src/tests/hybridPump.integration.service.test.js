import test from "node:test"
import assert from "node:assert/strict"
import {
  buildQueueJobFromQueueRow,
  buildQueueJobFromReservationRow,
  resolveHybridPaymentStatus,
  resolveQueueBaseState,
  resolveReservationBaseState,
  toEnginePump,
} from "../modules/queue/hybrid/integration.service.js"
import {
  PaymentStatus,
  PumpQueueState,
  PumpState,
  QueueJobState,
} from "../modules/queue/hybrid/index.js"

test("resolveHybridPaymentStatus maps wallet holds and posted transactions correctly", () => {
  assert.equal(
    resolveHybridPaymentStatus({
      serviceRequest: {
        holdReference: "HOLD-1",
      },
    }),
    PaymentStatus.PREAUTHORIZED
  )

  assert.equal(
    resolveHybridPaymentStatus({
      serviceRequest: {
        walletTransactionReference: "WTX-1",
      },
    }),
    PaymentStatus.PAID
  )

  assert.equal(resolveHybridPaymentStatus({}), PaymentStatus.UNPAID)
})

test("resolveQueueBaseState prefers fueling, readiness, and terminal row states", () => {
  assert.equal(
    resolveQueueBaseState(
      { status: "WAITING" },
      {
        attendantWorkflow: {
          serviceStartedAt: "2026-04-09T09:00:00.000Z",
        },
      }
    ),
    QueueJobState.FUELING
  )

  assert.equal(
    resolveQueueBaseState(
      { status: "WAITING" },
      {
        attendantWorkflow: {
          customerArrivedAt: "2026-04-09T08:50:00.000Z",
        },
      }
    ),
    QueueJobState.READY_ON_SITE
  )

  assert.equal(resolveQueueBaseState({ status: "CALLED" }, {}), QueueJobState.CALLED)
  assert.equal(resolveQueueBaseState({ status: "SERVED" }, {}), QueueJobState.COMPLETED)
})

test("resolveReservationBaseState maps checked-in and fulfilled reservations", () => {
  assert.equal(
    resolveReservationBaseState({ status: "CHECKED_IN" }, {}),
    QueueJobState.READY_ON_SITE
  )
  assert.equal(
    resolveReservationBaseState({ status: "FULFILLED" }, {}),
    QueueJobState.COMPLETED
  )
})

test("buildQueueJobFromQueueRow derives digital queue readiness and payment metadata", () => {
  const job = buildQueueJobFromQueueRow({
    id: 7,
    public_id: "Q-123",
    user_id: 14,
    user_public_id: "USR-14",
    status: "WAITING",
    joined_at: "2026-04-09T08:00:00.000Z",
    called_at: null,
    fuel_code: "petrol",
    metadata: JSON.stringify({
      requestedLitres: 25,
      serviceRequest: {
        holdReference: "HOLD-22",
        pumpPublicId: "PUMP-01",
      },
      attendantWorkflow: {
        customerArrivedAt: "2026-04-09T08:20:00.000Z",
      },
    }),
  })

  assert.equal(job.id, "QUEUE:Q-123")
  assert.equal(job.state, QueueJobState.READY_ON_SITE)
  assert.equal(job.customerId, "USR-14")
  assert.equal(job.paymentStatus, PaymentStatus.PREAUTHORIZED)
  assert.equal(job.requestedVolumeLitres, 25)
  assert.equal(job.assignedPumpId, "PUMP-01")
})

test("buildQueueJobFromReservationRow derives reservation readiness and lane commitment", () => {
  const job = buildQueueJobFromReservationRow(
    {
      id: 11,
      public_id: "RSV-9",
      user_public_id: "USR-99",
      status: "CONFIRMED",
      requested_litres: 30,
      confirmed_at: "2026-04-09T09:00:00.000Z",
      fuel_code: "diesel",
      metadata: JSON.stringify({
        hybridQueue: {
          isCommittedToLane: true,
          assignedPumpId: "PUMP-07",
        },
      }),
    },
    [
      {
        orderType: "RESERVATION",
        orderPublicId: "RSV-9",
        status: "COMMITTED",
      },
    ]
  )

  assert.equal(job.id, "RESERVATION:RSV-9")
  assert.equal(job.state, QueueJobState.ASSIGNED)
  assert.equal(job.assignedPumpId, "PUMP-07")
  assert.equal(job.isCommittedToLane, true)
  assert.equal(job.requestedVolumeLitres, 30)
})

test("toEnginePump derives offline, fueling, and reserved states from runtime context", () => {
  const offlinePump = toEnginePump(
    {
      public_id: "P-01",
      pump_number: 1,
      fuel_codes: ["PETROL"],
      status: "OFFLINE",
    },
    {},
    [],
    []
  )
  assert.equal(offlinePump.state, PumpState.OFFLINE)
  assert.equal(offlinePump.queueState, PumpQueueState.OPEN_TO_WALKINS)

  const fuelingPump = toEnginePump(
    {
      public_id: "P-02",
      pump_number: 2,
      fuel_codes: ["PETROL"],
      status: "DISPENSING",
    },
    {},
    [],
    []
  )
  assert.equal(fuelingPump.state, PumpState.FUELING)

  const reservedPump = toEnginePump(
    {
      public_id: "P-03",
      pump_number: 3,
      fuel_codes: ["PETROL"],
      status: "ACTIVE",
    },
    {
      current_assignment_public_id: "QUEUE:Q-500",
      queue_state: "DIGITAL_HOLD",
      hold_started_at: "2026-04-09T09:10:00.000Z",
    },
    [],
    []
  )
  assert.equal(reservedPump.state, PumpState.RESERVED)
  assert.equal(reservedPump.queueState, PumpQueueState.DIGITAL_HOLD)
  assert.equal(reservedPump.currentAssignmentId, "QUEUE:Q-500")
})

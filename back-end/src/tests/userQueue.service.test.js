import test from "node:test"
import assert from "node:assert/strict"
import { prisma } from "../db/prisma.js"
import {
  buildUserQueueStatusSnapshot,
  collectAssignedNozzlePublicIds,
  parsePumpQrPayload,
  resolveAssignableNozzle,
  toQueueRealtimeEvents,
} from "../modules/userQueue/service.js"

test("buildUserQueueStatusSnapshot returns guarantee payload and keeps legacy guarantee fields", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1

    if (callIndex === 1) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000001",
          station_id: 15,
          user_id: 700,
          position: 2,
          status: "WAITING",
          joined_at: "2026-02-26T09:50:00.000Z",
          called_at: null,
          last_moved_at: "2026-02-26T09:59:00.000Z",
          metadata: "{}",
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (callIndex === 2) {
      return [
        {
          total_queued: 3,
          cars_ahead: 1,
          now_serving: 1,
          last_movement_at: "2026-02-26T09:59:00.000Z",
        },
      ]
    }

    if (callIndex === 3) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
          priority_mode: "ON",
          hybrid_queue_n: 2,
        },
      ]
    }

    if (callIndex === 4) {
      return [{ avg_called_service_minutes: 4 }]
    }

    if (callIndex === 5) {
      return []
    }

    if (callIndex === 6) {
      return []
    }

    if (callIndex === 7) {
      return []
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000001",
      auth: { userId: 700 },
    })

    assert.equal(snapshot.queueJoinId, "01QUEUEJOINEXAMPLE0000000001")
    assert.equal(snapshot.guaranteeState, snapshot.guarantee.state)
    assert.equal(snapshot.guarantee.state, "none")
    assert.equal(snapshot.guarantee.fuelRemainingLiters, null)
    assert.equal(snapshot.guarantee.notes.includes("fuel_data_missing"), true)

    const events = toQueueRealtimeEvents(snapshot)
    const fuelEvent = events.find((event) => event.type === "queue:fuel")
    assert.ok(fuelEvent)
    assert.equal(fuelEvent.data.guaranteeState, snapshot.guaranteeState)
    assert.deepEqual(fuelEvent.data.guarantee, snapshot.guarantee)
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("parsePumpQrPayload reads smartlink and url pump QR formats", () => {
  assert.deepEqual(
    parsePumpQrPayload("smartlink:pump:01STATIONABC1234567890123:01STATIONABC1234567890123-P02"),
    {
      rawValue: "smartlink:pump:01STATIONABC1234567890123:01STATIONABC1234567890123-P02",
      stationPublicId: "01STATIONABC1234567890123",
      pumpPublicId: "01STATIONABC1234567890123-P02",
    }
  )

  assert.deepEqual(
    parsePumpQrPayload("https://smartlink.app/pump?stationPublicId=01STATIONABC1234567890123&pumpPublicId=01STATIONABC1234567890123-P03"),
    {
      rawValue: "https://smartlink.app/pump?stationPublicId=01STATIONABC1234567890123&pumpPublicId=01STATIONABC1234567890123-P03",
      stationPublicId: "01STATIONABC1234567890123",
      pumpPublicId: "01STATIONABC1234567890123-P03",
    }
  )
})

test("collectAssignedNozzlePublicIds keeps only other active assignments on the same pump", () => {
  const assignedNozzlePublicIds = collectAssignedNozzlePublicIds(
    [
      {
        public_id: "01QUEUEOTHER0000000000000001",
        metadata: JSON.stringify({
          lastPumpScan: {
            pumpPublicId: "01STATIONABC1234567890123-P02",
            nozzlePublicId: "01STATIONABC1234567890123-P02-N01",
          },
        }),
      },
      {
        public_id: "01QUEUEOTHER0000000000000002",
        metadata: JSON.stringify({
          lastPumpScan: {
            pumpPublicId: "01STATIONABC1234567890123-P03",
            nozzlePublicId: "01STATIONABC1234567890123-P03-N01",
          },
        }),
      },
      {
        public_id: "01QUEUESELF00000000000000001",
        metadata: JSON.stringify({
          lastPumpScan: {
            pumpPublicId: "01STATIONABC1234567890123-P02",
            nozzlePublicId: "01STATIONABC1234567890123-P02-N02",
          },
        }),
      },
    ],
    {
      pumpPublicId: "01STATIONABC1234567890123-P02",
      excludeQueueJoinId: "01QUEUESELF00000000000000001",
    }
  )

  assert.deepEqual(
    [...assignedNozzlePublicIds],
    ["01STATIONABC1234567890123-P02-N01"]
  )
})

test("resolveAssignableNozzle skips blocked nozzles and keeps the matching fuel type", () => {
  const nozzle = resolveAssignableNozzle(
    [
      {
        id: 1,
        public_id: "01STATIONABC1234567890123-P02-N01",
        nozzle_number: "1",
        status: "ACTIVE",
        fuel_code: "PETROL",
      },
      {
        id: 2,
        public_id: "01STATIONABC1234567890123-P02-N02",
        nozzle_number: "2",
        status: "ACTIVE",
        fuel_code: "PETROL",
      },
      {
        id: 3,
        public_id: "01STATIONABC1234567890123-P02-N03",
        nozzle_number: "3",
        status: "ACTIVE",
        fuel_code: "DIESEL",
      },
    ],
    "PETROL",
    {
      blockedNozzlePublicIds: ["01STATIONABC1234567890123-P02-N01"],
    }
  )

  assert.equal(nozzle?.public_id, "01STATIONABC1234567890123-P02-N02")
})

test("buildUserQueueStatusSnapshot exposes verified pump from queue metadata", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1

    if (callIndex === 1) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000002",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            lastPumpScan: {
              pumpPublicId: "01STATIONABC1234567890123-P04",
              pumpNumber: 4,
              pumpStatus: "ACTIVE",
              nozzlePublicId: "01STATIONABC1234567890123-P04-N01",
              nozzleNumber: "1",
              nozzleStatus: "ACTIVE",
              fuelType: "PETROL",
              scannedAt: "2026-02-26T10:06:00.000Z",
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (callIndex === 2) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (callIndex === 3) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (callIndex === 4) {
      return [{ avg_called_service_minutes: 4 }]
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000002",
      auth: { userId: 700 },
    })

    assert.deepEqual(snapshot.verifiedPump, {
      pumpPublicId: "01STATIONABC1234567890123-P04",
      pumpNumber: 4,
      pumpStatus: "ACTIVE",
      nozzlePublicId: "01STATIONABC1234567890123-P04-N01",
      nozzleNumber: "1",
      nozzleStatus: "ACTIVE",
      fuelType: "PETROL",
      scannedAt: "2026-02-26T10:06:00.000Z",
    })
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("buildUserQueueStatusSnapshot exposes queue payment mode and service request details", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1

    if (callIndex === 1) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000003",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            requestedLiters: 35,
            paymentMode: "PREPAY",
            prepaySelected: true,
            lastPumpScan: {
              pumpPublicId: "01STATIONABC1234567890123-P04",
              pumpNumber: 4,
              pumpStatus: "DISPENSING",
              scannedAt: "2026-02-26T10:06:00.000Z",
            },
            serviceRequest: {
              liters: 35,
              paymentMode: "PREPAY",
              prepaySelected: true,
              submittedAt: "2026-02-26T10:07:00.000Z",
              nozzlePublicId: "01STATIONABC1234567890123-P04-N01",
              pricePerLitre: 2500,
              estimatedAmount: 87500,
              currencyCode: "MWK",
              paymentStatus: "POSTED",
              walletTransactionReference: "WPM-EXAMPLE",
              settlementBatchPublicId: "01SETTLEMENTQUEUE0000000001",
              walletAvailableBalanceAfterPayment: 12500,
              dispensingStartedAt: "2026-02-26T10:07:00.000Z",
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (callIndex === 2) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (callIndex === 3) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (callIndex === 4) {
      return [{ avg_called_service_minutes: 4 }]
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000003",
      auth: { userId: 700 },
    })

    assert.equal(snapshot.requestedLiters, 35)
    assert.equal(snapshot.paymentMode, "PREPAY")
    assert.deepEqual(snapshot.serviceRequest, {
      liters: 35,
      paymentMode: "PREPAY",
      prepaySelected: true,
      submittedAt: "2026-02-26T10:07:00.000Z",
      pumpSessionPublicId: null,
      sessionReference: null,
      telemetryCorrelationId: null,
      pumpPublicId: "01STATIONABC1234567890123-P04",
      nozzlePublicId: "01STATIONABC1234567890123-P04-N01",
      pricePerLitre: 2500,
      estimatedAmount: 87500,
      currencyCode: "MWK",
      paymentStatus: "POSTED",
      holdReference: null,
      walletTransactionReference: "WPM-EXAMPLE",
      settlementBatchPublicId: "01SETTLEMENTQUEUE0000000001",
      walletAvailableBalanceAfterPayment: 12500,
      dispensingStartedAt: "2026-02-26T10:07:00.000Z",
      fuelType: null,
      needsPaymentRecheck: false,
      dispensedLitres: 0,
      dispensedAmount: 0,
      dispensingActive: false,
      dispensingProgressPercent: 0,
      liveUpdatedAt: null,
      pumpSessionStatus: null,
      pumpSessionReference: null,
    })
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("buildUserQueueStatusSnapshot derives live dispensing request when kiosk starts service", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1

    if (callIndex === 1) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000004",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            requestedLiters: 40,
            paymentMode: "PAY_AT_PUMP",
            lastPumpScan: {
              pumpPublicId: "01STATIONABC1234567890123-P05",
              pumpNumber: 5,
              pumpStatus: "DISPENSING",
              nozzlePublicId: "01STATIONABC1234567890123-P05-N01",
              nozzleNumber: "1",
              nozzleStatus: "DISPENSING",
              fuelType: "PETROL",
              scannedAt: "2026-02-26T10:06:00.000Z",
            },
            attendantWorkflow: {
              state: "DISPENSING",
              serviceStartedAt: "2026-02-26T10:07:00.000Z",
              pumpAssignment: {
                pumpPublicId: "01STATIONABC1234567890123-P05",
                nozzlePublicId: "01STATIONABC1234567890123-P05-N01",
                fuelType: "PETROL",
                confirmedAt: "2026-02-26T10:06:00.000Z",
              },
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (callIndex === 2) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (callIndex === 3) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (callIndex === 4) {
      return [{ avg_called_service_minutes: 4 }]
    }

    if (callIndex === 5) {
      return []
    }

    if (callIndex === 6) {
      return []
    }

    if (callIndex === 8) {
      return [
        {
          session_status: "DISPENSING",
          dispensed_litres: 12.5,
          session_reference: "PS-QUEUE-LIVE-001",
          start_time: "2026-02-26T10:07:00.000Z",
          end_time: null,
          updated_at: "2026-02-26T10:08:30.000Z",
        },
      ]
    }

    if (callIndex === 9) {
      return []
    }

    if (callIndex === 10) {
      return [
        {
          litres_value: 12.5,
          happened_at: "2026-02-26T10:08:30.000Z",
        },
      ]
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000004",
      auth: { userId: 700 },
    })

    assert.deepEqual(snapshot.serviceRequest, {
      liters: 40,
      paymentMode: "PAY_AT_PUMP",
      prepaySelected: false,
      submittedAt: "2026-02-26T10:07:00.000Z",
      pumpSessionPublicId: null,
      sessionReference: null,
      telemetryCorrelationId: null,
      pumpPublicId: "01STATIONABC1234567890123-P05",
      nozzlePublicId: "01STATIONABC1234567890123-P05-N01",
      pricePerLitre: null,
      estimatedAmount: null,
      currencyCode: "MWK",
      paymentStatus: "DISPENSING",
      holdReference: null,
      walletTransactionReference: null,
      settlementBatchPublicId: null,
      walletAvailableBalanceAfterPayment: null,
      dispensingStartedAt: "2026-02-26T10:07:00.000Z",
      fuelType: "PETROL",
      needsPaymentRecheck: false,
      dispensedLitres: 12.5,
      dispensedAmount: 0,
      dispensingActive: true,
      dispensingProgressPercent: 31,
      liveUpdatedAt: "2026-02-26T10:08:30.000Z",
      pumpSessionStatus: "DISPENSING",
      pumpSessionReference: "PS-QUEUE-LIVE-001",
    })
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("buildUserQueueStatusSnapshot uses the current pump session scope for live queue progress", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0
  let stopQueryUsedSessionScope = false
  let telemetryQueryUsedSessionScope = false

  prisma.$queryRaw = async (strings, ...values) => {
    callIndex += 1
    const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

    if (callIndex === 1) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000005",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            requestedLiters: 30,
            paymentMode: "PAY_AT_PUMP",
            lastPumpScan: {
              pumpPublicId: "01STATIONABC1234567890123-P06",
              pumpNumber: 6,
              pumpStatus: "DISPENSING",
              nozzlePublicId: "01STATIONABC1234567890123-P06-N01",
              nozzleNumber: "1",
              nozzleStatus: "DISPENSING",
              fuelType: "PETROL",
              scannedAt: "2026-02-26T10:06:00.000Z",
            },
            serviceRequest: {
              liters: 30,
              paymentMode: "PAY_AT_PUMP",
              submittedAt: "2026-02-26T10:06:00.000Z",
              pumpPublicId: "01STATIONABC1234567890123-P06",
              nozzlePublicId: "01STATIONABC1234567890123-P06-N01",
              currencyCode: "MWK",
              paymentStatus: "PENDING_AT_PUMP",
              dispensingStartedAt: "2026-02-26T10:07:00.000Z",
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (callIndex === 2) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (callIndex === 3) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (callIndex === 4) {
      return [{ avg_called_service_minutes: 4 }]
    }

    if (callIndex === 5) {
      return []
    }

    if (callIndex === 6) {
      return []
    }

    if (callIndex === 7) {
      return []
    }

    if (callIndex === 8) {
      return [
        {
          id: 501,
          session_status: "DISPENSING",
          dispensed_litres: 18.5,
          session_reference: "PS-CURRENT-QUEUE-001",
          telemetry_correlation_id: "TEL-CURRENT-QUEUE-001",
          start_time: "2026-02-26T10:07:00.000Z",
          end_time: null,
          updated_at: "2026-02-26T10:07:15.000Z",
        },
      ]
    }

    if (callIndex === 9) {
      assert.equal(queryText.includes("DISPENSING_STOPPED"), true)
      stopQueryUsedSessionScope =
        values.includes(501) || values.includes("TEL-CURRENT-QUEUE-001")
      return []
    }

    if (callIndex === 10) {
      telemetryQueryUsedSessionScope =
        values.includes(501) || values.includes("TEL-CURRENT-QUEUE-001")
      return [
        {
          litres_value: 18.5,
          happened_at: "2026-02-26T10:07:15.000Z",
        },
      ]
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000005",
      auth: { userId: 700 },
    })

    assert.equal(stopQueryUsedSessionScope, true)
    assert.equal(telemetryQueryUsedSessionScope, true)
    assert.equal(snapshot.serviceRequest?.dispensedLitres, 18.5)
    assert.equal(snapshot.serviceRequest?.dispensingActive, true)
    assert.equal(snapshot.serviceRequest?.dispensingProgressPercent, 62)
    assert.equal(snapshot.serviceRequest?.pumpSessionStatus, "DISPENSING")
    assert.equal(snapshot.serviceRequest?.pumpSessionReference, "PS-CURRENT-QUEUE-001")
    assert.equal(snapshot.serviceRequest?.liveUpdatedAt, "2026-02-26T10:07:15.000Z")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("buildUserQueueStatusSnapshot uses stop-event litres when dispensing has completed", async () => {
  const originalQueryRaw = prisma.$queryRaw

  prisma.$queryRaw = async (strings, ...values) => {
    const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

    if (queryText.includes("FROM queue_entries qe")) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000006",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            requestedLiters: 20,
            paymentMode: "PAY_AT_PUMP",
            serviceRequest: {
              liters: 20,
              paymentMode: "PAY_AT_PUMP",
              submittedAt: "2026-02-26T10:06:00.000Z",
              pumpPublicId: "01STATIONABC1234567890123-P07",
              nozzlePublicId: "01STATIONABC1234567890123-P07-N01",
              currencyCode: "MWK",
              paymentStatus: "DISPENSING",
              dispensingStartedAt: "2026-02-26T10:07:00.000Z",
              sessionReference: "PS-COMPLETED-QUEUE-001",
              telemetryCorrelationId: "TEL-COMPLETED-QUEUE-001",
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (queryText.includes("total_queued")) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (queryText.includes("joins_paused")) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (queryText.includes("FROM station_queue_settings")) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (queryText.includes("avg_called_service_minutes")) {
      return [{ avg_called_service_minutes: 4 }]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("ps.session_reference")) {
      return [
        {
          id: 601,
          session_status: "COMPLETED",
          dispensed_litres: 20,
          session_reference: "PS-COMPLETED-QUEUE-001",
          telemetry_correlation_id: "TEL-COMPLETED-QUEUE-001",
          start_time: "2026-02-26T10:07:00.000Z",
          end_time: "2026-02-26T10:08:00.000Z",
          updated_at: "2026-02-26T10:08:00.000Z",
        },
      ]
    }

    if (queryText.includes("FROM pump_telemetry_logs ptl") && queryText.includes("DISPENSING_STOPPED")) {
      assert.equal(queryText.includes("DISPENSING_STOPPED"), true)
      assert.equal(values.includes(601) || values.includes("TEL-COMPLETED-QUEUE-001"), true)
      return [
        {
          litres_value: 20,
          happened_at: "2026-02-26T10:08:00.000Z",
        },
      ]
    }

    if (queryText.includes("FROM pump_telemetry_logs ptl") && queryText.includes("ptl.litres_value IS NOT NULL")) {
      return []
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000006",
      auth: { userId: 700 },
    })

    assert.equal(snapshot.serviceRequest?.dispensedLitres, 20)
    assert.equal(snapshot.serviceRequest?.dispensingActive, false)
    assert.equal(snapshot.serviceRequest?.dispensingProgressPercent, 100)
    assert.equal(snapshot.serviceRequest?.pumpSessionStatus, "COMPLETED")
    assert.equal(snapshot.serviceRequest?.pumpSessionReference, "PS-COMPLETED-QUEUE-001")
    assert.equal(snapshot.serviceRequest?.liveUpdatedAt, "2026-02-26T10:08:00.000Z")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("buildUserQueueStatusSnapshot falls back to stop-event payload litres when stop row has no litres column", async () => {
  const originalQueryRaw = prisma.$queryRaw

  prisma.$queryRaw = async (strings, ...values) => {
    const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

    if (queryText.includes("FROM queue_entries qe")) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000007",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            requestedLiters: 15,
            paymentMode: "PAY_AT_PUMP",
            serviceRequest: {
              liters: 15,
              paymentMode: "PAY_AT_PUMP",
              submittedAt: "2026-02-26T10:06:00.000Z",
              pumpPublicId: "01STATIONABC1234567890123-P07",
              nozzlePublicId: "01STATIONABC1234567890123-P07-N01",
              currencyCode: "MWK",
              paymentStatus: "DISPENSING",
              dispensingStartedAt: "2026-02-26T10:07:00.000Z",
              sessionReference: "PS-COMPLETED-QUEUE-002",
              telemetryCorrelationId: "TEL-COMPLETED-QUEUE-002",
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (queryText.includes("total_queued")) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (queryText.includes("joins_paused") || queryText.includes("FROM station_queue_settings")) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (queryText.includes("avg_called_service_minutes")) {
      return [{ avg_called_service_minutes: 4 }]
    }

    if (queryText.includes("FROM pump_sessions ps") && queryText.includes("ps.session_reference")) {
      return [
        {
          id: 602,
          session_status: "COMPLETED",
          dispensed_litres: 12,
          session_reference: "PS-COMPLETED-QUEUE-002",
          telemetry_correlation_id: "TEL-COMPLETED-QUEUE-002",
          start_time: "2026-02-26T10:07:00.000Z",
          end_time: "2026-02-26T10:08:00.000Z",
          updated_at: "2026-02-26T10:08:00.000Z",
        },
      ]
    }

    if (queryText.includes("FROM pump_telemetry_logs ptl") && queryText.includes("DISPENSING_STOPPED")) {
      assert.equal(values.includes(602) || values.includes("TEL-COMPLETED-QUEUE-002"), true)
      return [
        {
          litres_value: null,
          payload_litres_value: null,
          payload_liters_value: null,
          payload_dispensed_litres: "15",
          payload_dispensed_litres_snake: null,
          happened_at: "2026-02-26T10:08:05.000Z",
        },
      ]
    }

    if (queryText.includes("FROM pump_telemetry_logs ptl") && queryText.includes("ptl.litres_value IS NOT NULL")) {
      return []
    }

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000007",
      auth: { userId: 700 },
    })

    assert.equal(snapshot.serviceRequest?.dispensedLitres, 15)
    assert.equal(snapshot.serviceRequest?.dispensingActive, false)
    assert.equal(snapshot.serviceRequest?.dispensingProgressPercent, 100)
    assert.equal(snapshot.serviceRequest?.pumpSessionStatus, "COMPLETED")
    assert.equal(snapshot.serviceRequest?.pumpSessionReference, "PS-COMPLETED-QUEUE-002")
    assert.equal(snapshot.serviceRequest?.liveUpdatedAt, "2026-02-26T10:08:05.000Z")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("buildUserQueueStatusSnapshot keeps SmartPay prepay mode when live service metadata only has wallet evidence", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1

    if (callIndex === 1) {
      return [
        {
          id: 1,
          public_id: "01QUEUEJOINEXAMPLE0000000010",
          station_id: 15,
          user_id: 700,
          position: 1,
          status: "CALLED",
          joined_at: "2026-02-26T10:00:00.000Z",
          called_at: "2026-02-26T10:05:00.000Z",
          last_moved_at: "2026-02-26T10:05:00.000Z",
          metadata: JSON.stringify({
            requestedLiters: 25,
            serviceRequest: {
              liters: 25,
              submittedAt: "2026-02-26T10:06:00.000Z",
              pumpPublicId: "01STATIONABC1234567890123-P09",
              nozzlePublicId: "01STATIONABC1234567890123-P09-N01",
              currencyCode: "MWK",
              paymentStatus: "HELD",
              holdReference: "SPH-QUEUE-001",
              dispensingStartedAt: "2026-02-26T10:07:00.000Z",
            },
          }),
          fuel_type: "PETROL",
          station_public_id: "01STATIONABC1234567890123",
          station_name: "SmartLink Central",
          station_brand: "SmartLink",
          station_area: "Blantyre",
        },
      ]
    }

    if (callIndex === 2) {
      return [
        {
          total_queued: 2,
          cars_ahead: 0,
          now_serving: 1,
          last_movement_at: "2026-02-26T10:05:00.000Z",
        },
      ]
    }

    if (callIndex === 3) {
      return [
        {
          station_id: 15,
          joins_paused: 0,
          capacity: 100,
          petrol_enabled: 1,
          diesel_enabled: 1,
        },
      ]
    }

    if (callIndex === 4) {
      return [{ avg_called_service_minutes: 4 }]
    }

    if (callIndex === 5) return []
    if (callIndex === 6) return []
    if (callIndex === 7) return []

    return []
  }

  try {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: "01QUEUEJOINEXAMPLE0000000010",
      auth: { userId: 700 },
    })

    assert.equal(snapshot.paymentMode, "PREPAY")
    assert.equal(snapshot.serviceRequest?.paymentMode, "PREPAY")
    assert.equal(snapshot.serviceRequest?.prepaySelected, true)
    assert.equal(snapshot.serviceRequest?.holdReference, "SPH-QUEUE-001")
    assert.equal(snapshot.serviceRequest?.paymentStatus, "HELD")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

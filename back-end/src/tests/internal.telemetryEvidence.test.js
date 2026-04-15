import test from "node:test"
import assert from "node:assert/strict"
import { prisma } from "../db/prisma.js"
import {
  getPumpSessionByTransaction,
  getTelemetryTimelineBySession,
} from "../modules/internal/service.js"

test("transaction verification evidence resolves transaction to pump session to telemetry logs", async () => {
  const originalQueryRaw = prisma.$queryRaw

  prisma.$queryRaw = async (strings, ...values) => {
    const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

    if (queryText.includes("FROM transactions tx")) {
      return [
        {
          id: 77,
          public_id: "01TXTELEMETRYCHAIN000000001",
          station_id: 14,
          user_id: 5,
          pump_id: 31,
          nozzle_id: 62,
          queue_entry_id: null,
          reservation_public_id: null,
          payment_reference: "PMT-REF-001",
          total_amount: "125000.00",
          requested_litres: "25.000",
          litres: "25.000",
          payment_method: "CASH",
          occurred_at: "2026-03-19T10:00:00.000Z",
          authorized_at: null,
          dispensed_at: "2026-03-19T10:12:00.000Z",
          settled_at: null,
          status: "RECORDED",
          settlement_impact_status: "UNCHANGED",
          workflow_reason_code: null,
          workflow_note: null,
          status_updated_at: null,
          status_updated_by_role_code: null,
          cancelled_at: null,
          station_public_id: "01STATIONEVIDENCE00000001",
          station_name: "SmartLink Kanengo",
          fuel_type_code: "PETROL",
          pump_public_id: "01PUMPEVIDENCE0000000001",
          pump_number: 3,
          nozzle_public_id: "01NOZZLEEVIDENCE00000001",
          nozzle_number: "2",
          queue_entry_public_id: null,
          queue_position: null,
          queue_status: null,
        },
      ]
    }

    if (queryText.includes("FROM pump_sessions ps")) {
      return [
        {
          id: 201,
          public_id: "01PUMPSESSIONEVIDENCE000001",
          session_reference: "PS-EVIDENCE-001",
          session_status: "COMPLETED",
          start_time: "2026-03-19T10:01:00.000Z",
          end_time: "2026-03-19T10:12:00.000Z",
          dispense_duration_seconds: 660,
          dispensed_litres: "25.000",
          error_code: null,
          error_message: null,
          telemetry_correlation_id: "TEL-EVIDENCE-001",
          created_at: "2026-03-19T10:01:00.000Z",
          updated_at: "2026-03-19T10:12:00.000Z",
          pump_public_id: "01PUMPEVIDENCE0000000001",
          pump_number: 3,
          nozzle_public_id: "01NOZZLEEVIDENCE00000001",
          nozzle_number: "2",
        },
      ]
    }

    if (queryText.includes("FROM pump_telemetry_logs ptl")) {
      return [
        {
          public_id: "01TELEMETRYEVIDENCELOG00001",
          event_type: "DISPENSING_STARTED",
          severity: "INFO",
          litres_value: null,
          flow_rate: "0.000",
          raw_error_code: null,
          message: "Dispensing started",
          payload_json: JSON.stringify({ transactionPublicId: values[0] || null }),
          source_type: "PUMP_CONTROLLER",
          happened_at: "2026-03-19T10:02:00.000Z",
          ingested_at: "2026-03-19T10:02:01.000Z",
        },
        {
          public_id: "01TELEMETRYEVIDENCELOG00002",
          event_type: "DISPENSING_STOPPED",
          severity: "INFO",
          litres_value: "25.000",
          flow_rate: "0.000",
          raw_error_code: null,
          message: "Dispensing stopped",
          payload_json: JSON.stringify({ sessionReference: "PS-EVIDENCE-001" }),
          source_type: "PUMP_CONTROLLER",
          happened_at: "2026-03-19T10:12:00.000Z",
          ingested_at: "2026-03-19T10:12:01.000Z",
        },
      ]
    }

    throw new Error(`Unexpected query in test: ${queryText} :: ${JSON.stringify(values)}`)
  }

  try {
    const pumpSession = await getPumpSessionByTransaction({
      transactionPublicId: "01TXTELEMETRYCHAIN000000001",
    })
    const telemetryTimeline = await getTelemetryTimelineBySession({
      transactionPublicId: "01TXTELEMETRYCHAIN000000001",
    })

    assert.equal(pumpSession.sessionReference, "PS-EVIDENCE-001")
    assert.equal(pumpSession.status, "COMPLETED")
    assert.equal(pumpSession.telemetryCorrelationId, "TEL-EVIDENCE-001")
    assert.equal(telemetryTimeline.length, 2)
    assert.equal(telemetryTimeline[0].eventType, "DISPENSING_STARTED")
    assert.equal(telemetryTimeline[1].eventType, "DISPENSING_STOPPED")
    assert.equal(telemetryTimeline[1].litresValue, 25)
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

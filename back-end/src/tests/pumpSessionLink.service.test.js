import test from "node:test"
import assert from "node:assert/strict"
import { linkTransactionToPumpSession } from "../modules/monitoring/pumpSessionLink.service.js"

test("linkTransactionToPumpSession creates a placeholder pump session when the transaction is created first", async () => {
  let insertedSession = null

  const db = {
    $queryRaw: async (strings) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
        return insertedSession ? [insertedSession] : []
      }

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("AND ps.pump_id =") && queryText.includes("ORDER BY")) {
        return []
      }

      throw new Error(`Unexpected query: ${queryText}`)
    },
    $executeRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("INSERT INTO pump_sessions")) {
        insertedSession = {
          id: 401,
          public_id: values[0],
          transaction_id: values[1],
          station_id: values[2],
          pump_id: values[3],
          nozzle_id: values[4],
          session_reference: values[5],
          session_status: values[6],
          start_time: values[7],
          end_time: values[8],
          dispensed_litres: values[10],
          telemetry_correlation_id: values[13],
          created_at: values[7],
          updated_at: values[7],
        }
        return 1
      }

      throw new Error(`Unexpected execute: ${queryText}`)
    },
  }

  const linked = await linkTransactionToPumpSession(db, {
    stationId: 9,
    transactionId: 77,
    pumpId: 14,
    nozzleId: 28,
    occurredAt: "2026-03-19T10:00:00.000Z",
  })

  assert.equal(linked?.id, 401)
  assert.equal(linked?.transactionId, 77)
  assert.equal(linked?.pumpId, 14)
  assert.equal(linked?.nozzleId, 28)
  assert.equal(linked?.status, "CREATED")
  assert.equal(linked?.telemetryCorrelationId, null)
  assert.match(String(linked?.sessionReference || ""), /^PS-/)
})

test("linkTransactionToPumpSession updates an existing pump session later and preserves telemetry linkage fields", async () => {
  let sessionRow = {
    id: 55,
    public_id: "01PUMPSESSIONLINKEXIST0000001",
    transaction_id: null,
    station_id: 3,
    pump_id: 44,
    nozzle_id: 81,
    session_reference: "PS-LATE-LINK-001",
    session_status: "DISPENSING",
    start_time: "2026-03-19T10:00:00.000Z",
    end_time: null,
    dispensed_litres: "12.500",
    telemetry_correlation_id: "TEL-LATE-LINK-001",
    created_at: "2026-03-19T10:00:00.000Z",
    updated_at: "2026-03-19T10:04:00.000Z",
  }

  const db = {
    $queryRaw: async (strings) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
        return sessionRow.transaction_id ? [sessionRow] : []
      }

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("AND ps.pump_id =") && queryText.includes("ORDER BY")) {
        return [sessionRow]
      }

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("AND ps.id =")) {
        return [sessionRow]
      }

      throw new Error(`Unexpected query: ${queryText}`)
    },
    $executeRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("UPDATE pump_sessions")) {
        sessionRow = {
          ...sessionRow,
          transaction_id: values[0],
        }
        return 1
      }

      throw new Error(`Unexpected execute: ${queryText}`)
    },
  }

  const linked = await linkTransactionToPumpSession(db, {
    stationId: 3,
    transactionId: 91,
    pumpId: 44,
    nozzleId: 81,
    occurredAt: "2026-03-19T10:05:00.000Z",
  })

  assert.equal(linked?.id, 55)
  assert.equal(linked?.transactionId, 91)
  assert.equal(linked?.sessionReference, "PS-LATE-LINK-001")
  assert.equal(linked?.telemetryCorrelationId, "TEL-LATE-LINK-001")
  assert.equal(linked?.status, "DISPENSING")
})

test("linkTransactionToPumpSession can bind a known telemetry session by session ID when the transaction arrives later", async () => {
  let sessionRow = {
    id: 66,
    public_id: "01PUMPSESSIONEXPLICIT0000001",
    transaction_id: null,
    station_id: 5,
    pump_id: 33,
    nozzle_id: 77,
    session_reference: "PS-EXPLICIT-LINK-001",
    session_status: "COMPLETED",
    start_time: "2026-03-19T09:30:00.000Z",
    end_time: "2026-03-19T09:40:00.000Z",
    dispensed_litres: "20.000",
    telemetry_correlation_id: "TEL-EXPLICIT-LINK-001",
    created_at: "2026-03-19T09:30:00.000Z",
    updated_at: "2026-03-19T09:40:00.000Z",
  }

  const db = {
    $queryRaw: async (strings) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
        return sessionRow.transaction_id ? [sessionRow] : []
      }

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("AND ps.id =")) {
        return [sessionRow]
      }

      throw new Error(`Unexpected query: ${queryText}`)
    },
    $executeRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("UPDATE pump_sessions")) {
        sessionRow = {
          ...sessionRow,
          transaction_id: values[0],
        }
        return 1
      }

      throw new Error(`Unexpected execute: ${queryText}`)
    },
  }

  const linked = await linkTransactionToPumpSession(db, {
    stationId: 5,
    transactionId: 123,
    pumpId: 33,
    nozzleId: 77,
    sessionId: 66,
    occurredAt: "2026-03-19T09:41:00.000Z",
  })

  assert.equal(linked?.id, 66)
  assert.equal(linked?.transactionId, 123)
  assert.equal(linked?.status, "COMPLETED")
  assert.equal(linked?.telemetryCorrelationId, "TEL-EXPLICIT-LINK-001")
})

test("linkTransactionToPumpSession can bind a known telemetry session by public session identity", async () => {
  let sessionRow = {
    id: 67,
    public_id: "01PUMPSESSIONPUBLICLINK00001",
    transaction_id: null,
    station_id: 5,
    pump_id: 33,
    nozzle_id: 77,
    session_reference: "PS-PUBLIC-LINK-001",
    session_status: "STARTED",
    start_time: "2026-03-19T09:30:00.000Z",
    end_time: null,
    dispensed_litres: "2.000",
    telemetry_correlation_id: "TEL-PUBLIC-LINK-001",
    created_at: "2026-03-19T09:30:00.000Z",
    updated_at: "2026-03-19T09:31:00.000Z",
  }

  const db = {
    $queryRaw: async (strings) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
        return sessionRow.transaction_id ? [sessionRow] : []
      }

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("ps.public_id =")) {
        return [sessionRow]
      }

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("AND ps.id =")) {
        return [sessionRow]
      }

      throw new Error(`Unexpected query: ${queryText}`)
    },
    $executeRaw: async (strings, ...values) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("UPDATE pump_sessions")) {
        sessionRow = {
          ...sessionRow,
          transaction_id: values[0],
        }
        return 1
      }

      throw new Error(`Unexpected execute: ${queryText}`)
    },
  }

  const linked = await linkTransactionToPumpSession(db, {
    stationId: 5,
    transactionId: 124,
    pumpId: 33,
    nozzleId: 77,
    sessionPublicId: "01PUMPSESSIONPUBLICLINK00001",
    occurredAt: "2026-03-19T09:41:00.000Z",
  })

  assert.equal(linked?.id, 67)
  assert.equal(linked?.transactionId, 124)
  assert.equal(linked?.publicId, "01PUMPSESSIONPUBLICLINK00001")
  assert.equal(linked?.sessionReference, "PS-PUBLIC-LINK-001")
})

test("linkTransactionToPumpSession rejects invalid attach attempts when the transaction is already linked elsewhere", async () => {
  const db = {
    $queryRaw: async (strings) => {
      const queryText = Array.isArray(strings) ? strings.join("?") : String(strings || "")

      if (queryText.includes("FROM pump_sessions ps") && queryText.includes("WHERE ps.transaction_id =")) {
        return [
          {
            id: 12,
            public_id: "01PUMPSESSIONCONFLICT000001",
            transaction_id: 88,
            station_id: 2,
            pump_id: 11,
            nozzle_id: 22,
            session_reference: "PS-CONFLICT-001",
            session_status: "STARTED",
            start_time: "2026-03-19T11:00:00.000Z",
            end_time: null,
            dispensed_litres: "0.000",
            telemetry_correlation_id: "TEL-CONFLICT-001",
            created_at: "2026-03-19T11:00:00.000Z",
            updated_at: "2026-03-19T11:01:00.000Z",
          },
        ]
      }

      throw new Error(`Unexpected query: ${queryText}`)
    },
    $executeRaw: async () => {
      throw new Error("No writes expected for a rejected attach attempt")
    },
  }

  await assert.rejects(
    () =>
      linkTransactionToPumpSession(db, {
        stationId: 2,
        transactionId: 88,
        pumpId: 11,
        nozzleId: 22,
        sessionId: 99,
      }),
    /already linked to a different pump session/i
  )
})

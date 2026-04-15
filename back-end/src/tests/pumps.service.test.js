import test from "node:test"
import assert from "node:assert/strict"
import { prisma } from "../db/prisma.js"
import {
  buildNozzlePublicId,
  buildPumpPublicId,
  buildPumpQrPayload,
  createNozzleForPump,
  derivePumpStatusFromNozzles,
  listStationPumpsWithNozzles,
  patchNozzleByPublicId,
  patchPumpGroup,
  resolveNozzleForTransaction,
} from "../modules/pumps/pumps.service.js"

test("pump and nozzle public ids follow station and pump numbering format", () => {
  const pumpPublicId = buildPumpPublicId("SL-MW-BLNT-4821", 2)
  const nozzlePublicId = buildNozzlePublicId(pumpPublicId, 3)

  assert.equal(pumpPublicId, "SL-MW-BLNT-4821-P02")
  assert.equal(nozzlePublicId, "SL-MW-BLNT-4821-P02-N03")
})

test("pump QR payload uses the canonical scan format", () => {
  assert.equal(
    buildPumpQrPayload("SL-MW-BLNT-4821", "SL-MW-BLNT-4821-P02"),
    "smartlink:pump:SL-MW-BLNT-4821:SL-MW-BLNT-4821-P02"
  )
})

test("derivePumpStatusFromNozzles computes dispenser aggregate status", () => {
  assert.equal(derivePumpStatusFromNozzles([{ status: "ACTIVE" }, { status: "OFFLINE" }]), "DEGRADED")
  assert.equal(derivePumpStatusFromNozzles([{ status: "OFFLINE" }, { status: "OFFLINE" }]), "OFFLINE")
  assert.equal(derivePumpStatusFromNozzles([{ status: "DISPENSING" }, { status: "ACTIVE" }]), "DISPENSING")
  assert.equal(derivePumpStatusFromNozzles([{ status: "ACTIVE" }, { status: "ACTIVE" }]), "ACTIVE")
  assert.equal(derivePumpStatusFromNozzles([{ status: "ACTIVE" }, { status: "ACTIVE" }], "PAUSED"), "PAUSED")
  assert.equal(derivePumpStatusFromNozzles([{ status: "PAUSED" }, { status: "PAUSED" }]), "PAUSED")
  assert.equal(derivePumpStatusFromNozzles([]), "OFFLINE")
  assert.equal(derivePumpStatusFromNozzles([], "PAUSED"), "PAUSED")
  assert.equal(derivePumpStatusFromNozzles([], "IDLE"), "IDLE")
})

test("listStationPumpsWithNozzles returns nested nozzles (integration-style with mocked DB)", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1
    if (callIndex === 1) {
      return [
        {
          id: 101,
          public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          status: "ACTIVE",
          status_reason: null,
          is_active: 1,
          station_public_id: "SL-MW-BLNT-4821",
          legacy_fuel_code: null,
          legacy_tank_public_id: null,
        },
      ]
    }
    if (callIndex === 2) {
      return [
        {
          id: 201,
          public_id: "NOZZLE_PUBLIC_001",
          nozzle_number: 1,
          side: "A",
          status: "ACTIVE",
          hardware_channel: "hw-1",
          is_active: 1,
          fuel_code: "PETROL",
          fuel_name: "Petrol",
          tank_public_id: "TANK_PUBLIC_001",
          tank_name: "Tank 1",
        },
      ]
    }
    return []
  }

  try {
    const rows = await listStationPumpsWithNozzles(1, { includeInactive: true })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].public_id, "PUMP_PUBLIC_001")
    assert.equal(rows[0].nozzles.length, 1)
    assert.equal(rows[0].nozzles[0].public_id, "NOZZLE_PUBLIC_001")
    assert.equal(rows[0].fuel_codes[0], "PETROL")
    assert.equal(rows[0].qr_payload, "smartlink:pump:SL-MW-BLNT-4821:PUMP_PUBLIC_001")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("listStationPumpsWithNozzles persists OFFLINE when a pump has no nozzles", async () => {
  const originalQueryRaw = prisma.$queryRaw
  const originalExecuteRaw = prisma.$executeRaw
  let callIndex = 0
  let persistedStatus = null

  prisma.$queryRaw = async () => {
    callIndex += 1
    if (callIndex === 1) {
      return [
        {
          id: 101,
          public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          status: "ACTIVE",
          status_reason: null,
          is_active: 1,
          station_public_id: "SL-MW-BLNT-4821",
          legacy_fuel_code: null,
          legacy_tank_public_id: null,
        },
      ]
    }
    if (callIndex === 2) {
      return []
    }
    return []
  }

  prisma.$executeRaw = async (...args) => {
    const [sql, statusArg] = args
    if (String(sql || "").includes("UPDATE pumps")) {
      persistedStatus = String(statusArg || "")
    }
    return 1
  }

  try {
    const rows = await listStationPumpsWithNozzles(1, { includeInactive: true })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, "OFFLINE")
    assert.equal(persistedStatus, "OFFLINE")
  } finally {
    prisma.$queryRaw = originalQueryRaw
    prisma.$executeRaw = originalExecuteRaw
  }
})

test("resolveNozzleForTransaction rejects missing nozzlePublicId", async () => {
  await assert.rejects(
    async () =>
      resolveNozzleForTransaction({
        stationId: 1,
        pumpPublicId: "PUMP_PUBLIC_001",
        nozzlePublicId: null,
      }),
    (error) =>
      error?.status === 400 &&
      error?.message === "nozzlePublicId is required for transactions"
  )
})

test("patchPumpGroup rejects status change when pump has no nozzles", async () => {
  const originalQueryRaw = prisma.$queryRaw
  let callIndex = 0

  prisma.$queryRaw = async () => {
    callIndex += 1
    if (callIndex === 1) {
      return [
        {
          id: 101,
          station_id: 1,
          public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          fuel_type_id: null,
          tank_id: null,
          status: "ACTIVE",
          status_reason: null,
          is_active: 1,
        },
      ]
    }
    if (callIndex === 2) {
      return []
    }
    return []
  }

  try {
    await assert.rejects(
      async () =>
        patchPumpGroup({
          stationId: 1,
          pumpPublicId: "PUMP_PUBLIC_001",
          payload: { status: "OFFLINE" },
        }),
      (error) =>
        error?.status === 400 &&
        error?.message === "Cannot change pump status: no nozzles are configured for this pump."
    )
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("createNozzleForPump accepts non-numeric nozzle numbers", async () => {
  const originalQueryRaw = prisma.$queryRaw
  const originalExecuteRaw = prisma.$executeRaw
  let queryCallIndex = 0
  const insertValues = []

  prisma.$queryRaw = async () => {
    queryCallIndex += 1
    if (queryCallIndex === 1) {
      return [
        {
          id: 101,
          station_id: 1,
          public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          fuel_type_id: null,
          tank_id: null,
          status: "ACTIVE",
          status_reason: null,
          is_active: 1,
        },
      ]
    }
    if (queryCallIndex === 2) {
      return [{ id: 1, code: "PETROL", name: "Petrol" }]
    }
    if (queryCallIndex === 3) {
      return []
    }
    if (queryCallIndex === 4) {
      return []
    }
    if (queryCallIndex === 5) {
      return [
        {
          public_id: insertValues[2],
          nozzle_number: "LEFT-A",
          side: "A",
          status: "ACTIVE",
          hardware_channel: null,
          is_active: 1,
          pump_public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          fuel_code: "PETROL",
          tank_public_id: null,
          tank_name: null,
        },
      ]
    }
    return []
  }

  prisma.$executeRaw = async (...args) => {
    insertValues.splice(0, insertValues.length, ...args.slice(1))
    return 1
  }

  try {
    const created = await createNozzleForPump({
      stationId: 1,
      pumpPublicId: "PUMP_PUBLIC_001",
      payload: { nozzleNumber: "LEFT-A", side: "A", fuelType: "PETROL" },
    })

    assert.equal(insertValues[3], "LEFT-A")
    assert.equal(created.nozzle_number, "LEFT-A")
    assert.match(String(created.public_id || ""), /^[0-9A-Z]{26}$/)
  } finally {
    prisma.$queryRaw = originalQueryRaw
    prisma.$executeRaw = originalExecuteRaw
  }
})

test("createNozzleForPump derives a side when the database requires one", async () => {
  const originalQueryRaw = prisma.$queryRaw
  const originalExecuteRaw = prisma.$executeRaw
  let queryCallIndex = 0
  const insertValues = []

  prisma.$queryRaw = async () => {
    queryCallIndex += 1
    if (queryCallIndex === 1) {
      return [
        {
          id: 101,
          station_id: 1,
          public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          fuel_type_id: null,
          tank_id: null,
          status: "ACTIVE",
          status_reason: null,
          is_active: 1,
        },
      ]
    }
    if (queryCallIndex === 2) {
      return [{ id: 1, code: "PETROL", name: "Petrol" }]
    }
    if (queryCallIndex === 3) {
      return []
    }
    if (queryCallIndex === 4) {
      return [
        {
          public_id: insertValues[2],
          nozzle_number: "2",
          side: "B",
          status: "ACTIVE",
          hardware_channel: null,
          is_active: 1,
          pump_public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          fuel_code: "PETROL",
          tank_public_id: null,
          tank_name: null,
        },
      ]
    }
    return []
  }

  prisma.$executeRaw = async (...args) => {
    insertValues.splice(0, insertValues.length, ...args.slice(1))
    return 1
  }

  try {
    const created = await createNozzleForPump({
      stationId: 1,
      pumpPublicId: "PUMP_PUBLIC_001",
      payload: { nozzleNumber: "2", fuelType: "PETROL" },
    })

    assert.equal(insertValues[4], "B")
    assert.equal(created.side, "B")
  } finally {
    prisma.$queryRaw = originalQueryRaw
    prisma.$executeRaw = originalExecuteRaw
  }
})

test("patchNozzleByPublicId keeps public_id stable for non-numeric nozzle number edits", async () => {
  const originalQueryRaw = prisma.$queryRaw
  const originalExecuteRawUnsafe = prisma.$executeRawUnsafe
  let queryCallIndex = 0
  let updatedSql = ""
  let updatedValues = []

  prisma.$queryRaw = async () => {
    queryCallIndex += 1
    if (queryCallIndex === 1) {
      return [
        {
          id: 201,
          pump_id: 101,
          fuel_type_id: 1,
          tank_id: null,
          nozzle_number: "1",
        },
      ]
    }
    if (queryCallIndex === 2) {
      return []
    }
    if (queryCallIndex === 3) {
      return [
        {
          public_id: "NOZZLE_PUBLIC_001",
          nozzle_number: "LEFT-A",
          side: "A",
          status: "ACTIVE",
          hardware_channel: null,
          is_active: 1,
          pump_public_id: "PUMP_PUBLIC_001",
          pump_number: 1,
          fuel_code: "PETROL",
          tank_public_id: null,
          tank_name: null,
        },
      ]
    }
    return []
  }

  prisma.$executeRawUnsafe = async (sql, ...values) => {
    updatedSql = String(sql || "")
    updatedValues = values
    return 1
  }

  try {
    const updated = await patchNozzleByPublicId({
      stationId: 1,
      nozzlePublicId: "NOZZLE_PUBLIC_001",
      payload: { nozzleNumber: "LEFT-A" },
    })

    assert.match(updatedSql, /UPDATE pump_nozzles SET nozzle_number = \? WHERE id = \?/)
    assert.deepEqual(updatedValues, ["LEFT-A", 201])
    assert.equal(updated.public_id, "NOZZLE_PUBLIC_001")
    assert.equal(updated.nozzle_number, "LEFT-A")
  } finally {
    prisma.$queryRaw = originalQueryRaw
    prisma.$executeRawUnsafe = originalExecuteRawUnsafe
  }
})

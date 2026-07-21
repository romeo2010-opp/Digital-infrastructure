import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  adjustLeaveBalance,
  planLeaveTransition,
} from "../src/services/hrOperationsService.js"

function createBalanceConnection(initialBalance = null) {
  const state = initialBalance ? { ...initialBalance } : null
  const holder = { balance: state, calls: [] }

  holder.query = async (sql, params) => {
    const normalized = sql.replace(/\s+/g, " ").trim()
    holder.calls.push({ sql: normalized, params })

    if (normalized.startsWith("INSERT INTO staff_leave_balances")) {
      const days = Number(params[4])
      if (holder.balance) holder.balance.used_days += days
      else holder.balance = { entitlement_days: 0, used_days: days, remaining_days: 0 }
      return [{ affectedRows: 1 }]
    }

    if (normalized.includes("SET used_days=GREATEST(used_days-?,0)")) {
      if (holder.balance) holder.balance.used_days = Math.max(holder.balance.used_days - Number(params[0]), 0)
      return [{ affectedRows: holder.balance ? 1 : 0 }]
    }

    if (normalized.includes("SET remaining_days=GREATEST(entitlement_days-used_days,0)")) {
      if (holder.balance) holder.balance.remaining_days = Math.max(holder.balance.entitlement_days - holder.balance.used_days, 0)
      return [{ affectedRows: holder.balance ? 1 : 0 }]
    }

    throw new Error(`Unexpected SQL in leave-balance test: ${normalized}`)
  }

  return holder
}

const leave = {
  staff_user_id: 42,
  leave_type: "annual",
  start_date: "2026-07-20",
  total_days: 2,
}

test("leave approval increments used days once and derives the remaining balance from the final total", async () => {
  const connection = createBalanceConnection({ entitlement_days: 20, used_days: 3, remaining_days: 17 })

  await adjustLeaveBalance(connection, 7, leave, 1)

  assert.deepEqual(connection.balance, { entitlement_days: 20, used_days: 5, remaining_days: 15 })
  assert.equal(connection.calls.length, 2)
  assert.match(connection.calls[0].sql, /ON DUPLICATE KEY UPDATE used_days=used_days\+VALUES\(used_days\)$/)
  assert.doesNotMatch(connection.calls[0].sql, /ON DUPLICATE KEY UPDATE[^]*remaining_days/)
  assert.deepEqual(connection.calls[1].params, [7, 42, "annual", 2026])
})

test("cancelling approved leave restores used and remaining days without allowing a negative used balance", async () => {
  const connection = createBalanceConnection({ entitlement_days: 20, used_days: 5, remaining_days: 15 })

  await adjustLeaveBalance(connection, 7, leave, -1)

  assert.deepEqual(connection.balance, { entitlement_days: 20, used_days: 3, remaining_days: 17 })
  assert.deepEqual(connection.calls[0].params, [2, 7, 42, "annual", 2026])

  connection.balance.used_days = 1
  await adjustLeaveBalance(connection, 7, leave, -1)
  assert.equal(connection.balance.used_days, 0)
  assert.equal(connection.balance.remaining_days, 20)
})

test("replayed leave transitions are explicit no-ops and never request another balance mutation", () => {
  assert.deepEqual(planLeaveTransition("approved", "approve"), {
    from: "pending",
    to: "approved",
    applied: false,
    balanceDirection: 0,
  })
  assert.deepEqual(planLeaveTransition("cancelled", "cancel"), {
    from: null,
    to: "cancelled",
    applied: false,
    balanceDirection: 0,
  })
  assert.equal(planLeaveTransition("pending", "approve").balanceDirection, 1)
  assert.equal(planLeaveTransition("approved", "cancel").balanceDirection, -1)
  assert.equal(planLeaveTransition("pending", "cancel").balanceDirection, 0)
})

test("leave state and balance updates remain guarded by one locked transaction", async () => {
  const service = await readFile(new URL("../src/services/hrOperationsService.js", import.meta.url), "utf8")

  assert.match(service, /beginTransaction\(\)[\s\S]*leaveByRef\(connection,schoolId,ref,true\)/)
  assert.match(service, /WHERE id=\? AND school_id=\? AND status=\?/)
  assert.match(service, /adjustLeaveBalance\(connection,schoolId,leave,transition\.balanceDirection\)[\s\S]*connection\.commit\(\)/)
  assert.match(service, /catch\(error\)\{await connection\.rollback\(\);throw error\}/)
})

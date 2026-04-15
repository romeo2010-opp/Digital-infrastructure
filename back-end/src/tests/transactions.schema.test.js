import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createTxSchema } from "../modules/transactions/routes.js"

test("transaction schema accepts new nozzle-first flow", () => {
  const parsed = createTxSchema.parse({
    nozzlePublicId: "01J5NOZZLEPUBLICID1234567890",
    totalVolume: 20,
    amount: 40000,
    paymentMethod: "CASH",
  })
  assert.equal(parsed.totalVolume, 20)
  assert.equal(parsed.amount, 40000)
})

test("transaction schema accepts SMARTPAY payment method", () => {
  const parsed = createTxSchema.parse({
    nozzlePublicId: "01J5NOZZLEPUBLICID1234567890",
    totalVolume: 20,
    amount: 40000,
    paymentMethod: "SMARTPAY",
  })
  assert.equal(parsed.paymentMethod, "SMARTPAY")
})

test("transactions schema stores SMARTPAY as a supported payment method", () => {
  const schemaSql = readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8")
  assert.match(
    schemaSql,
    /payment_method ENUM\('CASH','MOBILE_MONEY','CARD','OTHER','SMARTPAY'\) NOT NULL DEFAULT 'CASH'/
  )
})

test("transaction schema rejects pump-only payload", () => {
  assert.throws(() => {
    createTxSchema.parse({
      pumpPublicId: "01J5PUMPPUBLICID123456789012",
      totalVolume: 15,
      amount: 30000,
    })
  })
})

test("transaction schema rejects payload with no nozzle reference", () => {
  assert.throws(() => {
    createTxSchema.parse({
      totalVolume: 10,
      amount: 20000,
    })
  })
})

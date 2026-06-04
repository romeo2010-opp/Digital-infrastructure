import test from "node:test"
import assert from "node:assert/strict"
import {
  getMeraPacketDefinition,
  loadMeraPacketResult,
  MERA_PACKET_KEYS,
  normalizeMeraPacketKeys,
} from "../modules/mera/services/packetRegistry.service.js"

test("MERA packet registry exposes module packets without duplicates", () => {
  assert.equal(MERA_PACKET_KEYS.includes("overview"), true)
  assert.equal(MERA_PACKET_KEYS.includes("nationalOperations"), true)
  assert.equal(MERA_PACKET_KEYS.includes("notifications"), true)
  assert.equal(MERA_PACKET_KEYS.includes("priceCompliance"), true)
  assert.deepEqual(normalizeMeraPacketKeys(["overview", "overview", "notifications"]), ["overview", "notifications"])
})

test("MERA packet registry rejects unknown packet keys", async () => {
  const result = await loadMeraPacketResult("not-a-packet", { permissions: [] })
  assert.equal(result.key, "not-a-packet")
  assert.equal(result.status, "error")
  assert.match(result.error, /Unknown MERA packet/)
})

test("MERA packet registry reports forbidden packets without loading data", async () => {
  const result = await loadMeraPacketResult("overview", { permissions: [] })
  assert.equal(result.key, "overview")
  assert.equal(result.status, "forbidden")
  assert.match(result.error, /Forbidden MERA packet/)
})

test("MERA packet definitions provide permission and loader functions", () => {
  const definition = getMeraPacketDefinition("overview")
  assert.equal(typeof definition?.canLoad, "function")
  assert.equal(typeof definition?.load, "function")
})

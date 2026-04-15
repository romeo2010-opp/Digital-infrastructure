import test from "node:test"
import assert from "node:assert/strict"
import { PUBLIC_USER_ID_REGEX, generatePublicUserId } from "../utils/generateUserId.js"

test("generatePublicUserId returns the SmartLink user id format", async () => {
  const publicUserId = await generatePublicUserId({
    candidateFactory: () => "SLU-A3K9P2",
    exists: async () => false,
  })

  assert.equal(PUBLIC_USER_ID_REGEX.test(publicUserId), true)
})

test("generatePublicUserId returns a 10 character id including prefix", async () => {
  const publicUserId = await generatePublicUserId({
    candidateFactory: () => "SLU-9F2KD1",
    exists: async () => false,
  })

  assert.equal(publicUserId.length, 10)
})

test("generatePublicUserId generates unique ids across repeated calls", async () => {
  let counter = 0
  const seen = new Set()

  for (let index = 0; index < 12; index += 1) {
    const publicUserId = await generatePublicUserId({
      candidateFactory: () => `SLU-${(counter++).toString(36).toUpperCase().padStart(6, "0")}`,
      exists: async (candidate) => seen.has(candidate),
    })
    assert.equal(seen.has(publicUserId), false)
    seen.add(publicUserId)
  }

  assert.equal(seen.size, 12)
})

test("generatePublicUserId retries on collision", async () => {
  const attempted = []
  const candidates = ["SLU-A3K9P2", "SLU-A3K9P2", "SLU-K7P4QA"]

  const publicUserId = await generatePublicUserId({
    candidateFactory: () => candidates.shift() || "SLU-Z9X8W7",
    exists: async (candidate) => {
      attempted.push(candidate)
      return candidate === "SLU-A3K9P2"
    },
  })

  assert.equal(publicUserId, "SLU-K7P4QA")
  assert.deepEqual(attempted, ["SLU-A3K9P2", "SLU-A3K9P2", "SLU-K7P4QA"])
})

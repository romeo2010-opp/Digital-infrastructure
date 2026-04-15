import test from "node:test"
import assert from "node:assert/strict"
import { createWalletPublicIdValue } from "../modules/common/db.js"

test("createWalletPublicIdValue formats wallet ids as SLW-XXXX-XXXX", () => {
  const walletPublicId = createWalletPublicIdValue({
    randomSuffix: "4K9MR2TX",
  })

  assert.equal(walletPublicId, "SLW-4K9M-R2TX")
})

test("createWalletPublicIdValue excludes ambiguous characters", () => {
  const walletPublicId = createWalletPublicIdValue({
    randomSuffix: "O10I2Z8B",
  })

  assert.equal(walletPublicId, "SLW-2Z8B-AAAA")
  assert.equal(/[01OI]/.test(walletPublicId), false)
})

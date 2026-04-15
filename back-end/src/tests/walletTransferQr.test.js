import test from "node:test"
import assert from "node:assert/strict"
import {
  buildWalletTransferRecipientQrPayload,
  createWalletTransferRecipientQr,
  parseWalletTransferRecipientQrPayload,
} from "../modules/common/walletTransferQr.js"

test("wallet transfer recipient QR payload round-trips with signature validation", { concurrency: false }, () => {
  const originalSecret = process.env.WALLET_TRANSFER_QR_SECRET
  process.env.WALLET_TRANSFER_QR_SECRET = "wallet-transfer-test-secret"

  try {
    const issuedAt = new Date("2026-03-23T10:00:00.000Z")
    const expiresAt = new Date("2026-03-23T11:00:00.000Z")
    const built = buildWalletTransferRecipientQrPayload({
      recipientUserPublicId: "SLU-1234-ABCD",
      recipientDisplayId: "SLU-1234-ABCD",
      issuedAt,
      expiresAt,
      nonce: "fixed-nonce",
    })

    const parsed = parseWalletTransferRecipientQrPayload(built.payload, {
      now: new Date("2026-03-23T10:30:00.000Z"),
    })

    assert.equal(parsed.recipientUserPublicId, "SLU-1234-ABCD")
    assert.equal(parsed.recipientDisplayId, "SLU-1234-ABCD")
    assert.equal(parsed.nonce, "fixed-nonce")
    assert.equal(parsed.issuedAt, issuedAt.toISOString())
    assert.equal(parsed.expiresAt, expiresAt.toISOString())
  } finally {
    process.env.WALLET_TRANSFER_QR_SECRET = originalSecret
  }
})

test("wallet transfer recipient QR rejects tampered payloads", { concurrency: false }, () => {
  const originalSecret = process.env.WALLET_TRANSFER_QR_SECRET
  process.env.WALLET_TRANSFER_QR_SECRET = "wallet-transfer-test-secret"

  try {
    const built = buildWalletTransferRecipientQrPayload({
      recipientUserPublicId: "SLU-1234-ABCD",
      nonce: "fixed-nonce",
    })

    const tampered = `${built.payload.slice(0, -1)}${built.payload.endsWith("A") ? "B" : "A"}`

    assert.throws(
      () => parseWalletTransferRecipientQrPayload(tampered),
      /Recipient QR payload signature is invalid\./
    )
  } finally {
    process.env.WALLET_TRANSFER_QR_SECRET = originalSecret
  }
})

test("wallet transfer recipient QR rejects expired payloads", { concurrency: false }, () => {
  const originalSecret = process.env.WALLET_TRANSFER_QR_SECRET
  process.env.WALLET_TRANSFER_QR_SECRET = "wallet-transfer-test-secret"

  try {
    const built = buildWalletTransferRecipientQrPayload({
      recipientUserPublicId: "SLU-1234-ABCD",
      issuedAt: new Date("2026-03-23T08:00:00.000Z"),
      expiresAt: new Date("2026-03-23T08:15:00.000Z"),
      nonce: "expired-nonce",
    })

    assert.throws(
      () =>
        parseWalletTransferRecipientQrPayload(built.payload, {
          now: new Date("2026-03-23T08:15:00.000Z"),
        }),
      /Recipient QR payload has expired\./
    )
  } finally {
    process.env.WALLET_TRANSFER_QR_SECRET = originalSecret
  }
})

test("wallet transfer recipient QR renderer returns a scannable payload envelope", { concurrency: false }, async () => {
  const originalSecret = process.env.WALLET_TRANSFER_QR_SECRET
  process.env.WALLET_TRANSFER_QR_SECRET = "wallet-transfer-test-secret"

  try {
    const qr = await createWalletTransferRecipientQr({
      recipientUserPublicId: "SLU-1234-ABCD",
      recipientDisplayId: "SLU-1234-ABCD",
    })

    assert.match(qr.payload, /^sl:wt:/)
    assert.equal(qr.recipientUserPublicId, "SLU-1234-ABCD")
    assert.equal(qr.recipientDisplayId, "SLU-1234-ABCD")
    assert.equal(typeof qr.nonce, "string")
    assert.ok(qr.nonce.length > 0)
    assert.equal(typeof qr.imageDataUrl, "string")
    assert.match(qr.imageDataUrl, /^data:image\/png/)
    assert.ok(qr.payload.length < 220)
  } finally {
    process.env.WALLET_TRANSFER_QR_SECRET = originalSecret
  }
})

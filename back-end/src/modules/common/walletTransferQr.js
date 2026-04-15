import crypto from "node:crypto"

const WALLET_TRANSFER_QR_PREFIX = "smartlink:wallet-transfer:"
const WALLET_TRANSFER_QR_COMPACT_PREFIX = "sl:wt:"
const DEFAULT_WALLET_TRANSFER_QR_TTL_MIN = Number(process.env.WALLET_TRANSFER_QR_TTL_MIN || 60)
const WALLET_TRANSFER_QR_VERSION = 2

function walletTransferQrError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function resolveWalletTransferQrSecret() {
  return (
    String(process.env.WALLET_TRANSFER_QR_SECRET || "").trim()
    || String(process.env.JWT_ACCESS_SECRET || "").trim()
    || String(process.env.API_KEY || "").trim()
    || "smartlink-wallet-transfer-dev-secret"
  )
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url")
}

function parseBase64UrlJson(value) {
  try {
    const decoded = Buffer.from(String(value || ""), "base64url").toString("utf8")
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function signEncodedClaims(encodedClaims) {
  return crypto
    .createHmac("sha256", resolveWalletTransferQrSecret())
    .update(String(encodedClaims || ""))
    .digest("base64url")
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

async function renderQrSvgMarkup(payload) {
  try {
    const qrModule = await import("qrcode")
    const qrEncoder = qrModule?.toString ? qrModule : qrModule?.default
    if (!qrEncoder?.toString) return null
    return qrEncoder.toString(String(payload || ""), {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
  } catch {
    return null
  }
}

async function renderQrPngDataUrl(payload) {
  try {
    const qrModule = await import("qrcode")
    const qrEncoder = qrModule?.toDataURL ? qrModule : qrModule?.default
    if (!qrEncoder?.toDataURL) return null
    return qrEncoder.toDataURL(String(payload || ""), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 640,
      color: {
        dark: "#111111",
        light: "#FFFFFF",
      },
    })
  } catch {
    return null
  }
}

function toUnixSeconds(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor(date.getTime() / 1000)
}

function fromUnixSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000)
}

function normalizeWalletTransferQrClaims(rawClaims) {
  const claims = rawClaims && typeof rawClaims === "object" ? rawClaims : null
  if (!claims) return null

  if (Number(claims.v || 0) >= 2) {
    const issuedAt = fromUnixSeconds(claims.i)
    const expiresAt = fromUnixSeconds(claims.e)
    const recipientUserPublicId = String(claims.u || "").trim().toUpperCase()
    if (!issuedAt || !expiresAt || !recipientUserPublicId) return null

    return {
      version: Number(claims.v || 0),
      type: String(claims.t || "").trim() || "wr",
      recipientUserPublicId,
      recipientDisplayId: String(claims.d || "").trim() || recipientUserPublicId,
      issuedAt,
      expiresAt,
      nonce: String(claims.n || "").trim() || null,
      rawClaims: claims,
    }
  }

  const issuedAt = new Date(claims.issuedAt)
  const expiresAt = new Date(claims.expiresAt)
  const recipientUserPublicId = String(claims.recipientUserPublicId || "").trim().toUpperCase()
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || !recipientUserPublicId) {
    return null
  }

  return {
    version: Number(claims.v || 1),
    type: String(claims.typ || "").trim() || "wallet_recipient",
    recipientUserPublicId,
    recipientDisplayId: String(claims.recipientDisplayId || "").trim() || recipientUserPublicId,
    issuedAt,
    expiresAt,
    nonce: String(claims.nonce || "").trim() || null,
    rawClaims: claims,
  }
}

export function buildWalletTransferRecipientQrPayload({
  recipientUserPublicId,
  recipientDisplayId = "",
  issuedAt = new Date(),
  expiresAt = null,
  nonce = crypto.randomBytes(8).toString("hex"),
} = {}) {
  const scopedRecipientUserPublicId = String(recipientUserPublicId || "").trim().toUpperCase()
  if (!scopedRecipientUserPublicId) {
    throw walletTransferQrError("Recipient QR generation requires a recipient user id.")
  }

  const issuedAtDate = issuedAt instanceof Date ? issuedAt : new Date(issuedAt)
  if (Number.isNaN(issuedAtDate.getTime())) {
    throw walletTransferQrError("Recipient QR generation requires a valid issuedAt timestamp.")
  }

  const expiresAtDate =
    expiresAt === null
      ? new Date(issuedAtDate.getTime() + DEFAULT_WALLET_TRANSFER_QR_TTL_MIN * 60 * 1000)
      : expiresAt instanceof Date
        ? expiresAt
        : new Date(expiresAt)

  if (Number.isNaN(expiresAtDate.getTime())) {
    throw walletTransferQrError("Recipient QR generation requires a valid expiry timestamp.")
  }

  const claims = {
    v: WALLET_TRANSFER_QR_VERSION,
    t: "wr",
    u: scopedRecipientUserPublicId,
    d: String(recipientDisplayId || "").trim() || scopedRecipientUserPublicId,
    i: toUnixSeconds(issuedAtDate),
    e: toUnixSeconds(expiresAtDate),
    n: String(nonce || "").trim() || crypto.randomBytes(8).toString("hex"),
  }

  const encodedClaims = toBase64Url(JSON.stringify(claims))
  const signature = signEncodedClaims(encodedClaims)
  return {
    payload: `${WALLET_TRANSFER_QR_COMPACT_PREFIX}${encodedClaims}.${signature}`,
    claims,
    signature,
  }
}

export function parseWalletTransferRecipientQrPayload(payload, { now = new Date() } = {}) {
  const rawPayload = String(payload || "").trim()
  if (!rawPayload) {
    throw walletTransferQrError("Recipient QR payload is required.")
  }
  const prefix = rawPayload.startsWith(WALLET_TRANSFER_QR_COMPACT_PREFIX)
    ? WALLET_TRANSFER_QR_COMPACT_PREFIX
    : rawPayload.startsWith(WALLET_TRANSFER_QR_PREFIX)
      ? WALLET_TRANSFER_QR_PREFIX
      : null
  if (!prefix) {
    throw walletTransferQrError("Recipient QR payload is invalid.")
  }

  const token = rawPayload.slice(prefix.length)
  const separatorIndex = token.lastIndexOf(".")
  if (separatorIndex <= 0) {
    throw walletTransferQrError("Recipient QR payload signature is missing.")
  }

  const encodedClaims = token.slice(0, separatorIndex)
  const providedSignature = token.slice(separatorIndex + 1)
  const expectedSignature = signEncodedClaims(encodedClaims)
  const providedSignatureBuffer = Buffer.from(providedSignature || "")
  const expectedSignatureBuffer = Buffer.from(expectedSignature)
  if (
    !providedSignature
    || providedSignatureBuffer.length !== expectedSignatureBuffer.length
    || !crypto.timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)
  ) {
    throw walletTransferQrError("Recipient QR payload signature is invalid.")
  }

  const claims = parseBase64UrlJson(encodedClaims)
  if (!claims) {
    throw walletTransferQrError("Recipient QR payload is malformed.")
  }
  const normalizedClaims = normalizeWalletTransferQrClaims(claims)
  if (!normalizedClaims) {
    throw walletTransferQrError("Recipient QR payload is unsupported.")
  }

  const recipientUserPublicId = String(normalizedClaims.recipientUserPublicId || "").trim().toUpperCase()
  if (!recipientUserPublicId) {
    throw walletTransferQrError("Recipient QR payload is missing the recipient user id.")
  }

  const nowDate = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(nowDate.getTime())) {
    throw walletTransferQrError("Recipient QR validation requires a valid current timestamp.")
  }
  if (normalizedClaims.expiresAt.getTime() <= nowDate.getTime()) {
    throw walletTransferQrError("Recipient QR payload has expired.")
  }

  return {
    rawPayload,
    recipientUserPublicId,
    recipientDisplayId: String(normalizedClaims.recipientDisplayId || "").trim() || recipientUserPublicId,
    issuedAt: normalizedClaims.issuedAt.toISOString(),
    expiresAt: normalizedClaims.expiresAt.toISOString(),
    nonce: String(normalizedClaims.nonce || "").trim() || null,
    claims: normalizedClaims.rawClaims,
  }
}

export async function createWalletTransferRecipientQr({
  recipientUserPublicId,
  recipientDisplayId = "",
  issuedAt = new Date(),
  expiresAt = null,
} = {}) {
  const { payload, claims } = buildWalletTransferRecipientQrPayload({
    recipientUserPublicId,
    recipientDisplayId,
    issuedAt,
    expiresAt,
  })
  const [svg, pngDataUrl] = await Promise.all([
    renderQrSvgMarkup(payload),
    renderQrPngDataUrl(payload),
  ])

  return {
    payload,
    svg,
    imageDataUrl: pngDataUrl || (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null),
    issuedAt: toIsoOrNull(fromUnixSeconds(claims.i)),
    expiresAt: toIsoOrNull(fromUnixSeconds(claims.e)),
    recipientUserPublicId: claims.u,
    recipientDisplayId: claims.d,
    nonce: claims.n,
  }
}

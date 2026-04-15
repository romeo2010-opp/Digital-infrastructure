import crypto from "crypto"
import { badRequest } from "../../utils/http.js"

const PASSKEY_USER_HANDLE_MAX_BYTES = 64
const AUTH_DATA_MIN_LENGTH = 37
const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40

function normalizeBase64Url(value) {
  return String(value || "").trim()
}

export function randomBase64Url(size = 32) {
  return crypto.randomBytes(size).toString("base64url")
}

export function base64UrlToBuffer(value) {
  const normalized = normalizeBase64Url(value)
  if (!normalized) return Buffer.alloc(0)
  try {
    return Buffer.from(normalized, "base64url")
  } catch {
    throw badRequest("Invalid base64url payload")
  }
}

export function bufferToBase64Url(value) {
  return Buffer.from(value || []).toString("base64url")
}

export function buildUserHandle(value) {
  const normalized = String(value || "").trim()
  if (!normalized) throw badRequest("User handle is required for passkeys")
  const buffer = Buffer.from(normalized, "utf8")
  if (buffer.length > PASSKEY_USER_HANDLE_MAX_BYTES) {
    throw badRequest("User handle is too long for passkeys")
  }
  return bufferToBase64Url(buffer)
}

export function parseUserHandle(value) {
  const buffer = base64UrlToBuffer(value)
  if (!buffer.length) return null
  return buffer.toString("utf8")
}

export function resolveWebAuthnContext(req) {
  const explicitOrigin = normalizeOrigin(process.env.WEBAUTHN_ORIGIN || "")
  const requestOrigin = normalizeOrigin(req?.header?.("origin") || req?.header?.("referer") || "")
  const origin = explicitOrigin || requestOrigin
  if (!origin) {
    throw badRequest("Unable to determine the browser origin for passkeys")
  }

  const explicitRpId = normalizeRpId(process.env.WEBAUTHN_RP_ID || "")
  const requestRpId = normalizeRpId(new URL(origin).hostname)
  const rpId = explicitRpId || requestRpId
  if (!rpId) {
    throw badRequest("Unable to determine the relying party id for passkeys")
  }

  return {
    origin,
    rpId,
    rpName: String(process.env.WEBAUTHN_RP_NAME || "SmartLink").trim() || "SmartLink",
  }
}

function normalizeOrigin(value) {
  const scoped = String(value || "").trim()
  if (!scoped) return null

  try {
    const url = new URL(scoped)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function normalizeRpId(value) {
  const scoped = String(value || "").trim().toLowerCase()
  return scoped || null
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest()
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left || [])
  const rightBuffer = Buffer.from(right || [])
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function decodeCbor(input, start = 0) {
  const buffer = Buffer.from(input || [])
  if (start >= buffer.length) throw badRequest("Malformed CBOR payload")

  const initialByte = buffer[start]
  const majorType = initialByte >> 5
  const additionalInfo = initialByte & 0x1f
  let offset = start + 1

  const readLength = () => {
    if (additionalInfo < 24) return additionalInfo
    if (additionalInfo === 24) return buffer.readUInt8(offset++)
    if (additionalInfo === 25) {
      const value = buffer.readUInt16BE(offset)
      offset += 2
      return value
    }
    if (additionalInfo === 26) {
      const value = buffer.readUInt32BE(offset)
      offset += 4
      return value
    }
    if (additionalInfo === 27) {
      const value = Number(buffer.readBigUInt64BE(offset))
      offset += 8
      return value
    }
    throw badRequest("Unsupported CBOR length encoding")
  }

  switch (majorType) {
    case 0:
      return { value: readLength(), offset }
    case 1:
      return { value: -1 - readLength(), offset }
    case 2: {
      const length = readLength()
      const end = offset + length
      if (end > buffer.length) throw badRequest("Malformed CBOR byte string")
      return { value: buffer.subarray(offset, end), offset: end }
    }
    case 3: {
      const length = readLength()
      const end = offset + length
      if (end > buffer.length) throw badRequest("Malformed CBOR text string")
      return { value: buffer.subarray(offset, end).toString("utf8"), offset: end }
    }
    case 4: {
      const length = readLength()
      const values = []
      let cursor = offset
      for (let index = 0; index < length; index += 1) {
        const decoded = decodeCbor(buffer, cursor)
        values.push(decoded.value)
        cursor = decoded.offset
      }
      return { value: values, offset: cursor }
    }
    case 5: {
      const length = readLength()
      const values = new Map()
      let cursor = offset
      for (let index = 0; index < length; index += 1) {
        const keyDecoded = decodeCbor(buffer, cursor)
        const valueDecoded = decodeCbor(buffer, keyDecoded.offset)
        values.set(keyDecoded.value, valueDecoded.value)
        cursor = valueDecoded.offset
      }
      return { value: values, offset: cursor }
    }
    case 6: {
      const tagLength = readLength()
      void tagLength
      return decodeCbor(buffer, offset)
    }
    case 7:
      if (additionalInfo === 20) return { value: false, offset }
      if (additionalInfo === 21) return { value: true, offset }
      if (additionalInfo === 22) return { value: null, offset }
      throw badRequest("Unsupported CBOR simple value")
    default:
      throw badRequest("Unsupported CBOR major type")
  }
}

function parseAuthenticatorData(authDataBase64Url) {
  const authData = base64UrlToBuffer(authDataBase64Url)
  if (authData.length < AUTH_DATA_MIN_LENGTH) {
    throw badRequest("Authenticator data is malformed")
  }

  const rpIdHash = authData.subarray(0, 32)
  const flags = authData.readUInt8(32)
  const signCount = authData.readUInt32BE(33)
  let offset = AUTH_DATA_MIN_LENGTH
  let credentialId = null
  let credentialPublicKey = null

  if ((flags & FLAG_ATTESTED_CREDENTIAL_DATA) !== 0) {
    offset += 16
    const credentialIdLength = authData.readUInt16BE(offset)
    offset += 2
    credentialId = authData.subarray(offset, offset + credentialIdLength)
    offset += credentialIdLength

    const decoded = decodeCbor(authData, offset)
    credentialPublicKey = decoded.value
    offset = decoded.offset
  }

  return {
    raw: authData,
    rpIdHash,
    flags,
    signCount,
    credentialId,
    credentialPublicKey,
    userPresent: (flags & FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
  }
}

function coseKeyToPublicKeyPem(coseKey) {
  if (!(coseKey instanceof Map)) {
    throw badRequest("Credential public key is malformed")
  }

  const keyType = Number(coseKey.get(1))
  const algorithm = Number(coseKey.get(3))

  if (keyType === 2 && algorithm === -7) {
    const curve = Number(coseKey.get(-1))
    const x = coseKey.get(-2)
    const y = coseKey.get(-3)
    if (curve !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
      throw badRequest("Unsupported EC passkey parameters")
    }

    const keyObject = crypto.createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: bufferToBase64Url(x),
        y: bufferToBase64Url(y),
        ext: true,
      },
      format: "jwk",
    })
    return keyObject.export({ type: "spki", format: "pem" })
  }

  if (keyType === 3 && (algorithm === -257 || algorithm === -37)) {
    const modulus = coseKey.get(-1)
    const exponent = coseKey.get(-2)
    if (!Buffer.isBuffer(modulus) || !Buffer.isBuffer(exponent)) {
      throw badRequest("Unsupported RSA passkey parameters")
    }

    const keyObject = crypto.createPublicKey({
      key: {
        kty: "RSA",
        n: bufferToBase64Url(modulus),
        e: bufferToBase64Url(exponent),
        ext: true,
      },
      format: "jwk",
    })
    return keyObject.export({ type: "spki", format: "pem" })
  }

  throw badRequest("Unsupported passkey algorithm")
}

function parseClientDataJson(clientDataJSONBase64Url) {
  const raw = base64UrlToBuffer(clientDataJSONBase64Url)
  try {
    return {
      raw,
      parsed: JSON.parse(raw.toString("utf8")),
    }
  } catch {
    throw badRequest("Client data JSON is malformed")
  }
}

export function extractClientDataChallenge(clientDataJSONBase64Url) {
  const { parsed } = parseClientDataJson(clientDataJSONBase64Url)
  return String(parsed?.challenge || "").trim()
}

function verifyClientData({ parsedClientData, expectedType, expectedChallenge, expectedOrigin }) {
  const type = String(parsedClientData?.type || "").trim()
  const challenge = String(parsedClientData?.challenge || "").trim()
  const origin = normalizeOrigin(parsedClientData?.origin || "")

  if (type !== expectedType) {
    throw badRequest("Passkey operation type mismatch")
  }
  if (challenge !== String(expectedChallenge || "").trim()) {
    throw badRequest("Passkey challenge mismatch")
  }
  if (origin !== normalizeOrigin(expectedOrigin)) {
    throw badRequest("Passkey origin mismatch")
  }
}

function verifyRpIdHash(authenticatorData, expectedRpId) {
  const expectedHash = sha256(Buffer.from(String(expectedRpId || "").trim().toLowerCase(), "utf8"))
  if (!timingSafeEqual(authenticatorData.rpIdHash, expectedHash)) {
    throw badRequest("Passkey relying party mismatch")
  }
}

export function verifyPasskeyRegistration({
  credential,
  expectedChallenge,
  expectedOrigin,
  expectedRpId,
}) {
  const scopedCredential = credential || {}
  const clientData = parseClientDataJson(scopedCredential?.response?.clientDataJSON)
  verifyClientData({
    parsedClientData: clientData.parsed,
    expectedType: "webauthn.create",
    expectedChallenge,
    expectedOrigin,
  })

  const attestationObject = base64UrlToBuffer(scopedCredential?.response?.attestationObject)
  const decodedAttestation = decodeCbor(attestationObject)
  if (!(decodedAttestation.value instanceof Map)) {
    throw badRequest("Attestation object is malformed")
  }

  const authDataValue = decodedAttestation.value.get("authData")
  const authData = parseAuthenticatorData(bufferToBase64Url(authDataValue))
  verifyRpIdHash(authData, expectedRpId)

  if (!authData.userPresent) {
    throw badRequest("Passkey user presence is required")
  }
  if (!authData.userVerified) {
    throw badRequest("Passkey user verification is required")
  }
  if (!authData.credentialId || !authData.credentialPublicKey) {
    throw badRequest("Passkey attestation is missing credential data")
  }

  const credentialId = bufferToBase64Url(authData.credentialId)
  if (credentialId !== normalizeBase64Url(scopedCredential.id)) {
    throw badRequest("Passkey credential id mismatch")
  }

  const publicKeyPem = coseKeyToPublicKeyPem(authData.credentialPublicKey)

  return {
    credentialId,
    publicKeyPem,
    counter: authData.signCount,
    transports: Array.isArray(scopedCredential?.transports)
      ? scopedCredential.transports.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
  }
}

export function verifyPasskeyAuthentication({
  credential,
  expectedChallenge,
  expectedOrigin,
  expectedRpId,
  publicKeyPem,
  storedCounter = 0,
}) {
  const scopedCredential = credential || {}
  const clientData = parseClientDataJson(scopedCredential?.response?.clientDataJSON)
  verifyClientData({
    parsedClientData: clientData.parsed,
    expectedType: "webauthn.get",
    expectedChallenge,
    expectedOrigin,
  })

  const authenticatorData = parseAuthenticatorData(scopedCredential?.response?.authenticatorData)
  verifyRpIdHash(authenticatorData, expectedRpId)

  if (!authenticatorData.userPresent) {
    throw badRequest("Passkey user presence is required")
  }
  if (!authenticatorData.userVerified) {
    throw badRequest("Passkey user verification is required")
  }

  const clientDataHash = sha256(clientData.raw)
  const signedPayload = Buffer.concat([authenticatorData.raw, clientDataHash])
  const signature = base64UrlToBuffer(scopedCredential?.response?.signature)
  const isValid = crypto.verify(
    "sha256",
    signedPayload,
    publicKeyPem,
    signature
  )

  if (!isValid) {
    throw badRequest("Passkey signature verification failed")
  }

  const nextCounter = Number(authenticatorData.signCount || 0)
  const currentCounter = Number(storedCounter || 0)
  if (nextCounter > 0 && currentCounter > 0 && nextCounter <= currentCounter) {
    throw badRequest("Passkey signature counter did not advance")
  }

  return {
    credentialId: normalizeBase64Url(scopedCredential.id),
    nextCounter: nextCounter > currentCounter ? nextCounter : currentCounter,
    userHandle: parseUserHandle(scopedCredential?.response?.userHandle),
  }
}

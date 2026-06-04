import crypto from "node:crypto"
import jwt from "jsonwebtoken"
import { prisma } from "../../db/prisma.js"
import { badRequest, notFound, unauthorized } from "../../utils/http.js"
import { createPublicId, writeAuditLog } from "../common/db.js"
import { writeOperationalAudit } from "../common/operationalAudit.js"

const CHALLENGE_TTL_SECONDS = clampNumber(process.env.KIOSK_CHALLENGE_TTL_SECONDS, 90, 60, 120)
const REGISTRATION_CHALLENGE_TTL_SECONDS = clampNumber(
  process.env.KIOSK_REGISTRATION_CHALLENGE_TTL_SECONDS,
  300,
  60,
  900
)
const SESSION_TTL_MINUTES = clampNumber(process.env.KIOSK_SESSION_TTL_MINUTES, 240, 15, 12 * 60)
const IDLE_TIMEOUT_MINUTES = clampNumber(process.env.KIOSK_IDLE_TIMEOUT_MINUTES, 30, 5, 240)

const DISPLAY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const APPROVER_ROLES = new Set(["ATTENDANT", "MANAGER", "SUPERVISOR", "ADMIN"])
const MANAGER_SCOPE_ROLES = new Set(["MANAGER", "SUPERVISOR", "ADMIN"])
const MANAGER_ROLES = new Set(["MANAGER", "SUPERVISOR", "ADMIN"])
const INTERNAL_KIOSK_REGISTRAR_ROLES = new Set(["PLATFORM_OWNER", "PLATFORM_INFRASTRUCTURE_ENGINEER"])

export const ATTENDANT_KIOSK_PERMISSIONS = Object.freeze([
  "VIEW_QUEUE",
  "CONFIRM_CUSTOMER",
  "START_SERVICE",
  "MARK_NO_SHOW",
  "REPORT_DISPUTE",
  "LOCK_KIOSK",
])

export const MANAGER_KIOSK_PERMISSIONS = Object.freeze([
  "VIEW_QUEUE",
  "CONFIRM_CUSTOMER",
  "START_SERVICE",
  "MARK_NO_SHOW",
  "REPORT_DISPUTE",
  "PAUSE_KIOSK",
  "OVERRIDE_QUEUE",
  "VIEW_SHIFT_TOTALS",
  "REVOKE_KIOSK_SESSION",
  "LOCK_KIOSK",
])

function clampNumber(rawValue, fallback, min, max) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function normalizeOptional(value) {
  const scoped = String(value || "").trim()
  return scoped || null
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase()
}

function throwForbidden(message = "Forbidden") {
  const error = new Error(message)
  error.status = 403
  throw error
}

function readClientMeta(req) {
  return {
    userAgent: req.header("user-agent")?.slice(0, 255) || null,
    ipAddress: (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
  }
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex")
}

function createChallengeSecret() {
  return crypto.randomBytes(32).toString("base64url")
}

function createDisplayCode() {
  let result = ""
  for (let index = 0; index < 6; index += 1) {
    result += DISPLAY_CODE_ALPHABET[Math.floor(Math.random() * DISPLAY_CODE_ALPHABET.length)]
  }
  return `${result.slice(0, 3)}-${result.slice(3)}`
}

function toStatus(value) {
  return String(value || "").trim().toLowerCase()
}

function safeJsonParseArray(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function getApprovalBaseUrl(req) {
  const configured =
    normalizeOptional(process.env.KIOSK_APPROVAL_BASE_URL) ||
    normalizeOptional(process.env.PUBLIC_FRONTEND_BASE_URL) ||
    normalizeOptional(process.env.PUBLIC_BASE_URL)
  const fallback = `${req.protocol}://${req.get("host")}`
  const base = String(configured || fallback).replace(/\/+$/, "")
  const productionSecureRequired =
    String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" ||
    String(process.env.COOKIE_SECURE || "").trim().toLowerCase() === "true"

  if (productionSecureRequired && !base.startsWith("https://")) {
    throw badRequest("Kiosk approval URL must use HTTPS in production")
  }

  return base
}

function getInternalApprovalBaseUrl(req) {
  const configured =
    normalizeOptional(process.env.KIOSK_INTERNAL_APPROVAL_BASE_URL) ||
    normalizeOptional(process.env.INTERNAL_FRONTEND_BASE_URL) ||
    normalizeOptional(process.env.INTERNAL_BASE_URL) ||
    normalizeOptional(process.env.KIOSK_APPROVAL_BASE_URL) ||
    normalizeOptional(process.env.PUBLIC_FRONTEND_BASE_URL) ||
    normalizeOptional(process.env.PUBLIC_BASE_URL)
  const fallback = `${req.protocol}://${req.get("host")}`
  const base = String(configured || fallback).replace(/\/+$/, "")
  const productionSecureRequired =
    String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" ||
    String(process.env.COOKIE_SECURE || "").trim().toLowerCase() === "true"

  if (productionSecureRequired && !base.startsWith("https://")) {
    throw badRequest("Kiosk internal registration URL must use HTTPS in production")
  }

  return base
}

async function renderQrImageDataUrl(payload) {
  const qrModule = await import("qrcode")
  const qrEncoder = qrModule?.toDataURL ? qrModule : qrModule?.default
  if (!qrEncoder?.toDataURL) return null
  return qrEncoder.toDataURL(String(payload || ""), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360,
    color: {
      dark: "#0b1520",
      light: "#ffffff",
    },
  })
}

function mapKiosk(row) {
  if (!row) return null
  return {
    id: Number(row.kiosk_id || row.id || 0),
    publicId: row.kiosk_public_id || row.public_id || null,
    stationId: Number(row.station_id || 0),
    stationPublicId: row.station_public_id || null,
    stationName: row.station_name || "Station",
    stationTimeZone: row.station_timezone || "Africa/Blantyre",
    name: row.kiosk_name || row.name || "Station kiosk",
    code: row.kiosk_code || null,
    locationLabel: row.location_label || null,
    assignedPumpId: row.assigned_pump_id ? Number(row.assigned_pump_id) : null,
    assignedPumpPublicId: row.assigned_pump_public_id || null,
    assignedPumpNumber: row.assigned_pump_number === null || row.assigned_pump_number === undefined
      ? null
      : Number(row.assigned_pump_number),
    assignedPumpName: row.assigned_pump_name || null,
    currentMode: row.current_mode || "OPEN_WALKIN",
    allowedModes: safeJsonParseArray(row.allowed_modes_json),
    status: row.kiosk_status || row.status || "ACTIVE",
  }
}

async function findActiveKioskDevice({ deviceFingerprint, kioskPublicId = null }) {
  const fingerprint = normalizeOptional(deviceFingerprint)
  if (!fingerprint) throw badRequest("Kiosk device fingerprint is required")
  const fingerprintHash = hashValue(fingerprint)
  const scopedKioskPublicId = normalizeOptional(kioskPublicId)

  const rows = await prisma.$queryRaw`
    SELECT
      kd.id AS kiosk_id,
      kd.public_id AS kiosk_public_id,
      kd.kiosk_code,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.assigned_pump_id,
      kd.allowed_modes_json,
      kd.status AS kiosk_status,
      p.public_id AS assigned_pump_public_id,
      p.pump_number AS assigned_pump_number,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS assigned_pump_name,
      pc.current_mode,
      st.id AS station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone
    FROM kiosk_devices kd
    INNER JOIN stations st ON st.id = kd.station_id
    LEFT JOIN pumps p ON p.id = kd.assigned_pump_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    WHERE (kd.device_fingerprint = ${fingerprint} OR kd.device_fingerprint = ${fingerprintHash})
      AND (${scopedKioskPublicId} IS NULL OR kd.public_id = ${scopedKioskPublicId})
      AND kd.status = 'ACTIVE'
      AND st.is_active = 1
    LIMIT 1
  `

  return mapKiosk(rows?.[0] || null)
}

async function expirePendingChallengesForKiosk(kioskId) {
  await prisma.$executeRaw`
    UPDATE kiosk_login_challenges
    SET status = 'EXPIRED'
    WHERE kiosk_id = ${kioskId}
      AND status = 'PENDING'
      AND expires_at <= CURRENT_TIMESTAMP(3)
  `
}

export async function createKioskChallenge({ payload, req }) {
  const kiosk = await findActiveKioskDevice({
    deviceFingerprint: payload?.deviceFingerprint,
    kioskPublicId: payload?.kioskId,
  })
  if (!kiosk?.id) {
    throw unauthorized("Kiosk device is not registered or is disabled")
  }

  await expirePendingChallengesForKiosk(kiosk.id)
  const challengeId = createPublicId()
  const challengeSecret = createChallengeSecret()
  const displayCode = createDisplayCode()
  const expiresAt = addSeconds(new Date(), CHALLENGE_TTL_SECONDS)
  const meta = readClientMeta(req)

  await prisma.$executeRaw`
    INSERT INTO kiosk_login_challenges (
      public_id,
      kiosk_id,
      station_id,
      display_code,
      challenge_hash,
      status,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES (
      ${challengeId},
      ${kiosk.id},
      ${kiosk.stationId},
      ${displayCode},
      ${hashValue(challengeSecret)},
      'PENDING',
      ${expiresAt},
      ${meta.ipAddress},
      ${meta.userAgent}
    )
  `

  await prisma.$executeRaw`
    UPDATE kiosk_devices
    SET last_seen_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${kiosk.id}
  `

  const qrUrl = `${getApprovalBaseUrl(req)}/kiosk/approve?challenge=${encodeURIComponent(challengeId)}`
  const qrImageDataUrl = await renderQrImageDataUrl(qrUrl)

  return {
    challengeId,
    challengeSecret,
    qrUrl,
    qrImageDataUrl,
    displayCode,
    stationName: kiosk.stationName,
    stationPublicId: kiosk.stationPublicId,
    kioskName: kiosk.name,
    locationLabel: kiosk.locationLabel,
    requestedAccessLevel: "Station kiosk operations",
    expiresAt,
  }
}

async function expirePendingRegistrationChallengesForFingerprint(fingerprintHash) {
  await prisma.$executeRaw`
    UPDATE kiosk_registration_challenges
    SET status = 'EXPIRED'
    WHERE device_fingerprint_hash = ${fingerprintHash}
      AND status = 'PENDING'
  `
}

export async function createKioskRegistrationChallenge({ payload, req }) {
  const deviceFingerprint = normalizeOptional(payload?.deviceFingerprint)
  if (!deviceFingerprint) throw badRequest("Kiosk device fingerprint is required")

  const existingKiosk = await findActiveKioskDevice({
    deviceFingerprint,
  })
  if (existingKiosk?.id) {
    return {
      alreadyRegistered: true,
      status: "approved",
      stationName: existingKiosk.stationName,
      stationPublicId: existingKiosk.stationPublicId,
      kioskId: existingKiosk.publicId,
      kioskName: existingKiosk.name,
      locationLabel: existingKiosk.locationLabel,
    }
  }

  const fingerprintHash = hashValue(deviceFingerprint)
  await expirePendingRegistrationChallengesForFingerprint(fingerprintHash)

  const challengeId = createPublicId()
  const challengeSecret = createChallengeSecret()
  const displayCode = createDisplayCode()
  const expiresAt = addSeconds(new Date(), REGISTRATION_CHALLENGE_TTL_SECONDS)
  const meta = readClientMeta(req)

  await prisma.$executeRaw`
    INSERT INTO kiosk_registration_challenges (
      public_id,
      display_code,
      challenge_hash,
      device_fingerprint_hash,
      status,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES (
      ${challengeId},
      ${displayCode},
      ${hashValue(challengeSecret)},
      ${fingerprintHash},
      'PENDING',
      ${expiresAt},
      ${meta.ipAddress},
      ${meta.userAgent}
    )
  `

  const qrUrl = `${getInternalApprovalBaseUrl(req)}/kiosk/register?challenge=${encodeURIComponent(challengeId)}`
  const qrImageDataUrl = await renderQrImageDataUrl(qrUrl)

  return {
    challengeId,
    challengeSecret,
    qrUrl,
    qrImageDataUrl,
    displayCode,
    expiresAt,
  }
}

async function loadRegistrationChallenge(challengeId) {
  const rows = await prisma.$queryRaw`
    SELECT
      krc.id,
      krc.public_id,
      krc.display_code,
      krc.challenge_hash,
      krc.device_fingerprint_hash,
      krc.status,
      krc.expires_at,
      krc.registered_kiosk_id,
      krc.approved_by_user_id,
      krc.approved_at,
      krc.denied_at,
      krc.ip_address,
      krc.user_agent,
      krc.created_at,
      kd.public_id AS kiosk_public_id,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.status AS kiosk_status,
      st.id AS station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      u.public_id AS approved_by_public_id,
      u.full_name AS approved_by_name
    FROM kiosk_registration_challenges krc
    LEFT JOIN kiosk_devices kd ON kd.id = krc.registered_kiosk_id
    LEFT JOIN stations st ON st.id = kd.station_id
    LEFT JOIN users u ON u.id = krc.approved_by_user_id
    WHERE krc.public_id = ${challengeId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function markRegistrationChallengeExpiredIfNeeded(challenge) {
  if (!challenge?.id) return challenge
  if (String(challenge.status || "").toUpperCase() !== "PENDING") return challenge
  const expiresAt = new Date(challenge.expires_at)
  if (expiresAt.getTime() > Date.now()) return challenge

  await prisma.$executeRaw`
    UPDATE kiosk_registration_challenges
    SET status = 'EXPIRED'
    WHERE id = ${challenge.id}
      AND status = 'PENDING'
  `
  return {
    ...challenge,
    status: "EXPIRED",
  }
}

function readKioskRegistrationSecret(req) {
  return (
    normalizeOptional(req.header("x-kiosk-registration-secret")) ||
    normalizeOptional(req.query?.registrationSecret) ||
    normalizeOptional(req.query?.challengeSecret) ||
    normalizeOptional(req.query?.secret)
  )
}

function mapRegisteredKioskFromRegistration(challenge) {
  if (!challenge?.registered_kiosk_id) return null
  return {
    kioskId: challenge.kiosk_public_id || null,
    name: challenge.kiosk_name || "Station kiosk",
    locationLabel: challenge.location_label || null,
    status: challenge.kiosk_status || "ACTIVE",
    stationPublicId: challenge.station_public_id || null,
    stationName: challenge.station_name || "Station",
    stationTimeZone: challenge.station_timezone || "Africa/Blantyre",
  }
}

function mapRegistrationChallengeForInternal(challenge) {
  return {
    challengeId: challenge.public_id,
    status: toStatus(challenge.status),
    displayCode: challenge.display_code,
    deviceFingerprintHash: challenge.device_fingerprint_hash,
    ipAddress: challenge.ip_address || null,
    userAgent: challenge.user_agent || null,
    createdAt: challenge.created_at,
    expiresAt: challenge.expires_at,
    approvedAt: challenge.approved_at || null,
    deniedAt: challenge.denied_at || null,
    approvedBy: challenge.approved_by_user_id
      ? {
          userPublicId: challenge.approved_by_public_id || null,
          fullName: challenge.approved_by_name || "Internal user",
        }
      : null,
    kiosk: mapRegisteredKioskFromRegistration(challenge),
  }
}

export async function getRegistrationChallengeStatus({ challengeId, req }) {
  const loaded = await loadRegistrationChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk registration challenge not found")
  const challenge = await markRegistrationChallengeExpiredIfNeeded(loaded)
  const challengeSecret = readKioskRegistrationSecret(req)
  if (!challengeSecret || hashValue(challengeSecret) !== challenge.challenge_hash) {
    throw unauthorized("Invalid kiosk registration challenge secret")
  }

  return {
    status: toStatus(challenge.status),
    displayCode: challenge.display_code,
    expiresAt: challenge.expires_at,
    kiosk: mapRegisteredKioskFromRegistration(challenge),
  }
}

function assertInternalKioskRegistrar(internalAuth) {
  const roles = Array.isArray(internalAuth?.roles) ? internalAuth.roles : []
  const authorized = roles.some((roleCode) => INTERNAL_KIOSK_REGISTRAR_ROLES.has(String(roleCode || "").trim()))
  if (!authorized) {
    throwForbidden("Internal kiosk registration requires platform owner or infrastructure engineer access")
  }
}

async function findStationForKioskRegistration(stationPublicId) {
  const scopedStationPublicId = normalizeOptional(stationPublicId)
  if (!scopedStationPublicId) throw badRequest("Station is required")

  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, timezone
    FROM stations
    WHERE public_id = ${scopedStationPublicId}
      AND is_active = 1
    LIMIT 1
  `
  const station = rows?.[0] || null
  if (!station?.id) throw badRequest("Select an active station for this kiosk")
  return station
}

async function loadRegisteredKioskById(kioskId) {
  const rows = await prisma.$queryRaw`
    SELECT
      kd.id AS kiosk_id,
      kd.public_id AS kiosk_public_id,
      kd.kiosk_code,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.assigned_pump_id,
      kd.allowed_modes_json,
      kd.status AS kiosk_status,
      p.public_id AS assigned_pump_public_id,
      p.pump_number AS assigned_pump_number,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS assigned_pump_name,
      pc.current_mode,
      st.id AS station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone
    FROM kiosk_devices kd
    INNER JOIN stations st ON st.id = kd.station_id
    LEFT JOIN pumps p ON p.id = kd.assigned_pump_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    WHERE kd.id = ${kioskId}
    LIMIT 1
  `
  return mapKiosk(rows?.[0] || null)
}

export async function getRegistrationChallengeForInternal({ challengeId, internalAuth }) {
  assertInternalKioskRegistrar(internalAuth)
  const loaded = await loadRegistrationChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk registration challenge not found")
  const challenge = await markRegistrationChallengeExpiredIfNeeded(loaded)
  return mapRegistrationChallengeForInternal(challenge)
}

export async function listStationsForKioskRegistration({ internalAuth }) {
  assertInternalKioskRegistrar(internalAuth)
  const rows = await prisma.$queryRaw`
    SELECT public_id, name, city, operator_name, is_active
    FROM stations
    WHERE is_active = 1
    ORDER BY name ASC
  `
  return {
    items: rows || [],
  }
}

export async function approveRegistrationChallenge({ challengeId, payload, internalAuth, req }) {
  assertInternalKioskRegistrar(internalAuth)
  const loaded = await loadRegistrationChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk registration challenge not found")
  const challenge = await markRegistrationChallengeExpiredIfNeeded(loaded)
  if (String(challenge.status || "").toUpperCase() !== "PENDING") {
    throw badRequest("Kiosk registration challenge is no longer pending")
  }

  const station = await findStationForKioskRegistration(payload?.stationPublicId)
  const kioskName = String(payload?.name || "").trim()
  if (!kioskName) throw badRequest("Kiosk name is required")
  const locationLabel = normalizeOptional(payload?.locationLabel)

  const registration = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw`
      SELECT id, public_id, status, expires_at, device_fingerprint_hash, display_code
      FROM kiosk_registration_challenges
      WHERE id = ${challenge.id}
      LIMIT 1
      FOR UPDATE
    `
    const current = lockRows?.[0]
    if (!current?.id) throw notFound("Kiosk registration challenge not found")
    if (String(current.status || "").toUpperCase() !== "PENDING") {
      throw badRequest("Kiosk registration challenge is no longer pending")
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await tx.$executeRaw`
        UPDATE kiosk_registration_challenges
        SET status = 'EXPIRED'
        WHERE id = ${challenge.id}
      `
      throw badRequest("Kiosk registration challenge has expired")
    }

    const existingRows = await tx.$queryRaw`
      SELECT id, public_id
      FROM kiosk_devices
      WHERE device_fingerprint = ${current.device_fingerprint_hash}
      LIMIT 1
      FOR UPDATE
    `
    const existing = existingRows?.[0] || null
    let kioskId = existing?.id || null
    let kioskPublicId = existing?.public_id || createPublicId()

    if (existing?.id) {
      await tx.$executeRaw`
        UPDATE kiosk_devices
        SET
          station_id = ${station.id},
          name = ${kioskName},
          location_label = ${locationLabel},
          status = 'ACTIVE',
          last_seen_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${existing.id}
      `
    } else {
      await tx.$executeRaw`
        INSERT INTO kiosk_devices (
          public_id,
          station_id,
          name,
          location_label,
          device_fingerprint,
          status,
          last_seen_at
        )
        VALUES (
          ${kioskPublicId},
          ${station.id},
          ${kioskName},
          ${locationLabel},
          ${current.device_fingerprint_hash},
          'ACTIVE',
          CURRENT_TIMESTAMP(3)
        )
      `
      const insertedRows = await tx.$queryRaw`
        SELECT id, public_id
        FROM kiosk_devices
        WHERE public_id = ${kioskPublicId}
        LIMIT 1
      `
      kioskId = insertedRows?.[0]?.id || null
    }

    if (!kioskId) throw badRequest("Unable to register kiosk")

    await tx.$executeRaw`
      UPDATE kiosk_registration_challenges
      SET
        status = 'APPROVED',
        registered_kiosk_id = ${kioskId},
        approved_by_user_id = ${internalAuth.userId},
        approved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${challenge.id}
    `

    return {
      kioskId,
      kioskPublicId,
      displayCode: current.display_code,
    }
  })

  const registeredKiosk = await loadRegisteredKioskById(registration.kioskId)

  await writeSecurityAuditLog({
    actorId: internalAuth.userId,
    action: "KIOSK_REGISTRATION_APPROVED",
    entityType: "KioskRegistrationChallenge",
    entityId: challenge.public_id,
    metadata: {
      stationPublicId: station.public_id,
      kioskId: registration.kioskPublicId,
      kioskName,
      locationLabel,
      displayCode: registration.displayCode,
    },
    req,
  })
  await writeInternalAuditLog({
    actor: internalAuth,
    actionType: "KIOSK_REGISTRATION_APPROVED",
    targetType: "KioskRegistrationChallenge",
    targetPublicId: challenge.public_id,
    summary: `Registered kiosk ${kioskName} for ${station.name}`,
    severity: "HIGH",
    metadata: {
      stationPublicId: station.public_id,
      kioskId: registration.kioskPublicId,
      locationLabel,
      displayCode: registration.displayCode,
    },
  })

  return {
    approved: true,
    kiosk: registeredKiosk
      ? {
          kioskId: registeredKiosk.publicId,
          name: registeredKiosk.name,
          locationLabel: registeredKiosk.locationLabel,
          stationPublicId: registeredKiosk.stationPublicId,
          stationName: registeredKiosk.stationName,
        }
      : null,
  }
}

export async function denyRegistrationChallenge({ challengeId, internalAuth, req }) {
  assertInternalKioskRegistrar(internalAuth)
  const loaded = await loadRegistrationChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk registration challenge not found")
  const challenge = await markRegistrationChallengeExpiredIfNeeded(loaded)
  if (String(challenge.status || "").toUpperCase() !== "PENDING") {
    throw badRequest("Kiosk registration challenge is no longer pending")
  }

  await prisma.$executeRaw`
    UPDATE kiosk_registration_challenges
    SET status = 'DENIED', denied_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${challenge.id}
      AND status = 'PENDING'
  `

  await writeSecurityAuditLog({
    actorId: internalAuth.userId,
    action: "KIOSK_REGISTRATION_DENIED",
    entityType: "KioskRegistrationChallenge",
    entityId: challenge.public_id,
    metadata: {
      displayCode: challenge.display_code,
      deviceFingerprintHash: challenge.device_fingerprint_hash,
    },
    req,
  })
  await writeInternalAuditLog({
    actor: internalAuth,
    actionType: "KIOSK_REGISTRATION_DENIED",
    targetType: "KioskRegistrationChallenge",
    targetPublicId: challenge.public_id,
    summary: `Denied kiosk registration ${challenge.display_code}`,
    severity: "MEDIUM",
    metadata: {
      displayCode: challenge.display_code,
      deviceFingerprintHash: challenge.device_fingerprint_hash,
    },
  })

  return {
    denied: true,
  }
}

async function loadChallenge(challengeId) {
  const rows = await prisma.$queryRaw`
    SELECT
      klc.id,
      klc.public_id,
      klc.kiosk_id,
      klc.station_id,
      klc.display_code,
      klc.challenge_hash,
      klc.status,
      klc.expires_at,
      klc.approved_by_user_id,
      klc.approved_at,
      klc.denied_at,
      kd.public_id AS kiosk_public_id,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.status AS kiosk_status,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone
    FROM kiosk_login_challenges klc
    INNER JOIN kiosk_devices kd ON kd.id = klc.kiosk_id
    INNER JOIN stations st ON st.id = klc.station_id
    WHERE klc.public_id = ${challengeId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function markChallengeExpiredIfNeeded(challenge) {
  if (!challenge?.id) return challenge
  if (String(challenge.status || "").toUpperCase() !== "PENDING") return challenge
  const expiresAt = new Date(challenge.expires_at)
  if (expiresAt.getTime() > Date.now()) return challenge

  await prisma.$executeRaw`
    UPDATE kiosk_login_challenges
    SET status = 'EXPIRED'
    WHERE id = ${challenge.id}
      AND status = 'PENDING'
  `
  return {
    ...challenge,
    status: "EXPIRED",
  }
}

function mapChallengeForApproval(challenge, roleScope = null) {
  return {
    challengeId: challenge.public_id,
    status: toStatus(challenge.status),
    stationName: challenge.station_name || "Station",
    stationPublicId: challenge.station_public_id || null,
    kioskName: challenge.kiosk_name || "Station kiosk",
    locationLabel: challenge.location_label || null,
    displayCode: challenge.display_code,
    requestedAccessLevel: "Station kiosk operations",
    approverRoleScope: roleScope,
    expiresAt: challenge.expires_at,
  }
}

async function findStationStaffForApproval({ userId, stationId }) {
  if (!userId || !stationId) return null
  const rows = await prisma.$queryRaw`
    SELECT
      ss.id AS staff_id,
      ss.user_id,
      ss.station_id,
      sr.code AS role_code
    FROM station_staff ss
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    WHERE ss.user_id = ${userId}
      AND ss.station_id = ${stationId}
      AND ss.is_active = 1
    LIMIT 1
  `
  return rows?.[0] || null
}

function roleScopeForStaff(roleCode) {
  const normalized = normalizeRole(roleCode)
  if (!APPROVER_ROLES.has(normalized)) return null
  return MANAGER_SCOPE_ROLES.has(normalized) ? "MANAGER" : "ATTENDANT"
}

async function writeSecurityAuditLog({ actorId = null, action, entityType, entityId = null, metadata = {}, req }) {
  const meta = readClientMeta(req)
  await prisma.$executeRaw`
    INSERT INTO security_audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata_json,
      ip_address,
      user_agent
    )
    VALUES (
      ${actorId || null},
      ${action},
      ${entityType},
      ${entityId},
      ${JSON.stringify(metadata || {})},
      ${meta.ipAddress},
      ${meta.userAgent}
    )
  `
}

async function writeInternalAuditLog({
  actor,
  actionType,
  targetType,
  targetPublicId = null,
  summary,
  severity = "MEDIUM",
  metadata = {},
}) {
  await prisma.$executeRaw`
    INSERT INTO internal_audit_log (
      public_id,
      actor_user_id,
      actor_role_code,
      action_type,
      target_type,
      target_public_id,
      summary,
      severity,
      metadata
    )
    VALUES (
      ${createPublicId()},
      ${actor?.userId || null},
      ${actor?.primaryRole || actor?.roles?.[0] || null},
      ${actionType},
      ${targetType},
      ${targetPublicId},
      ${summary},
      ${severity},
      ${JSON.stringify(metadata || {})}
    )
  `
}

async function writeKioskStationAuditLog({ stationId, actorStaffId = null, actionType, payload = {} }) {
  if (!stationId) return
  await writeAuditLog({
    stationId,
    actorStaffId,
    actionType,
    payload,
  })
}

async function assertApproverForChallenge({ auth, challenge, req, action }) {
  const staff = await findStationStaffForApproval({
    userId: auth?.userId,
    stationId: challenge?.station_id,
  })
  const roleScope = roleScopeForStaff(staff?.role_code)

  if (!roleScope) {
    await writeSecurityAuditLog({
      actorId: auth?.userId || null,
      action: "KIOSK_APPROVAL_SUSPICIOUS_ATTEMPT",
      entityType: "KioskLoginChallenge",
      entityId: challenge?.public_id || null,
      metadata: {
        requestedAction: action,
        stationId: challenge?.station_id?.toString?.() || String(challenge?.station_id || ""),
        role: staff?.role_code || auth?.role || null,
        reason: "User is not authorized for this station kiosk challenge",
      },
      req,
    })
    throwForbidden("You are not authorized to approve this kiosk")
  }

  return {
    staff,
    roleScope,
    permissions: roleScope === "MANAGER" ? MANAGER_KIOSK_PERMISSIONS : ATTENDANT_KIOSK_PERMISSIONS,
  }
}

export async function getChallengeForApproval({ challengeId, auth, req }) {
  const loaded = await loadChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk challenge not found")
  const challenge = await markChallengeExpiredIfNeeded(loaded)
  const approval = await assertApproverForChallenge({
    auth,
    challenge,
    req,
    action: "VIEW",
  })
  return mapChallengeForApproval(challenge, approval.roleScope)
}

function readKioskChallengeSecret(req) {
  return (
    normalizeOptional(req.header("x-kiosk-challenge-secret")) ||
    normalizeOptional(req.query?.challengeSecret) ||
    normalizeOptional(req.query?.secret)
  )
}

export async function getChallengeStatus({ challengeId, req }) {
  const loaded = await loadChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk challenge not found")
  const challenge = await markChallengeExpiredIfNeeded(loaded)
  const challengeSecret = readKioskChallengeSecret(req)
  if (!challengeSecret || hashValue(challengeSecret) !== challenge.challenge_hash) {
    throw unauthorized("Invalid kiosk challenge secret")
  }

  const status = toStatus(challenge.status)
  if (status !== "approved") {
    return {
      status,
      expiresAt: challenge.expires_at,
    }
  }

  const rows = await prisma.$queryRaw`
    SELECT
      ks.public_id,
      ks.kiosk_id,
      ks.station_id,
      ks.approved_by_user_id,
      ks.role_scope,
      ks.permissions_json,
      ks.status,
      ks.started_at,
      ks.expires_at,
      ks.last_heartbeat_at,
      u.public_id AS approved_by_public_id,
      u.full_name AS approved_by_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      kd.kiosk_code,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.assigned_pump_id,
      kd.allowed_modes_json,
      p.public_id AS assigned_pump_public_id,
      p.pump_number AS assigned_pump_number,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS assigned_pump_name,
      pc.current_mode
    FROM kiosk_sessions ks
    INNER JOIN users u ON u.id = ks.approved_by_user_id
    INNER JOIN stations st ON st.id = ks.station_id
    INNER JOIN kiosk_devices kd ON kd.id = ks.kiosk_id
    LEFT JOIN pumps p ON p.id = kd.assigned_pump_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    WHERE ks.kiosk_id = ${challenge.kiosk_id}
      AND ks.station_id = ${challenge.station_id}
      AND ks.status = 'ACTIVE'
      AND ks.expires_at > CURRENT_TIMESTAMP(3)
    ORDER BY ks.id DESC
    LIMIT 1
  `
  const session = rows?.[0] || null
  if (!session?.public_id) {
    return {
      status: "expired",
      expiresAt: challenge.expires_at,
    }
  }

  const accessToken = signKioskAccessToken(session)
  return {
    status: "approved",
    expiresAt: challenge.expires_at,
    session: mapKioskSession(session, { accessToken }),
  }
}

function signKioskAccessToken(session) {
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) throw badRequest("JWT access secret is not configured")
  const expiresAt = new Date(session.expires_at)
  const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  const permissions = safeJsonParseArray(session.permissions_json)
  return jwt.sign(
    {
      typ: "kiosk",
      sub: `kiosk:${session.public_id}`,
      sid: session.public_id,
      kioskSessionId: session.public_id,
      kioskId: session.kiosk_id ? Number(session.kiosk_id) : undefined,
      uid: Number(session.approved_by_user_id),
      stationId: Number(session.station_id),
      stationPublicId: session.station_public_id,
      assignedPumpId: session.assigned_pump_id ? Number(session.assigned_pump_id) : undefined,
      assignedPumpPublicId: session.assigned_pump_public_id || undefined,
      role: String(session.role_scope || "ATTENDANT").toUpperCase(),
      permissions,
    },
    secret,
    {
      expiresIn: `${ttlSeconds}s`,
    }
  )
}

function mapKioskSession(row, { accessToken = undefined } = {}) {
  const session = {
    sessionId: row.public_id,
    status: toStatus(row.status),
    roleScope: String(row.role_scope || "ATTENDANT").toUpperCase(),
    permissions: safeJsonParseArray(row.permissions_json),
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    lastHeartbeatAt: row.last_heartbeat_at || null,
    approvedBy: {
      userPublicId: row.approved_by_public_id || null,
      fullName: row.approved_by_name || "Station staff",
    },
    station: {
      publicId: row.station_public_id || null,
      name: row.station_name || "Station",
      timezone: row.station_timezone || "Africa/Blantyre",
    },
    kiosk: {
      name: row.kiosk_name || "Station kiosk",
      code: row.kiosk_code || null,
      locationLabel: row.location_label || null,
      assignedPumpId: row.assigned_pump_id ? Number(row.assigned_pump_id) : null,
      assignedPumpPublicId: row.assigned_pump_public_id || null,
      assignedPumpNumber: row.assigned_pump_number === null || row.assigned_pump_number === undefined
        ? null
        : Number(row.assigned_pump_number),
      assignedPumpName: row.assigned_pump_name || null,
      currentMode: row.current_mode || "OPEN_WALKIN",
      allowedModes: safeJsonParseArray(row.allowed_modes_json),
    },
  }
  if (accessToken !== undefined) {
    session.accessToken = accessToken
  }
  return session
}

export async function approveChallenge({ challengeId, auth, req }) {
  const loaded = await loadChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk challenge not found")
  const challenge = await markChallengeExpiredIfNeeded(loaded)
  const approval = await assertApproverForChallenge({
    auth,
    challenge,
    req,
    action: "APPROVE",
  })

  if (String(challenge.kiosk_status || "").toUpperCase() !== "ACTIVE") {
    throw badRequest("Kiosk is not active")
  }
  if (String(challenge.status || "").toUpperCase() !== "PENDING") {
    throw badRequest("Kiosk challenge is no longer pending")
  }

  const sessionPublicId = createPublicId()
  const expiresAt = addMinutes(new Date(), SESSION_TTL_MINUTES)
  const permissionsJson = JSON.stringify(approval.permissions)

  await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw`
      SELECT id, status, expires_at
      FROM kiosk_login_challenges
      WHERE id = ${challenge.id}
      LIMIT 1
      FOR UPDATE
    `
    const current = lockRows?.[0]
    if (!current?.id) throw notFound("Kiosk challenge not found")
    if (String(current.status || "").toUpperCase() !== "PENDING") {
      throw badRequest("Kiosk challenge is no longer pending")
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await tx.$executeRaw`
        UPDATE kiosk_login_challenges
        SET status = 'EXPIRED'
        WHERE id = ${challenge.id}
      `
      throw badRequest("Kiosk challenge has expired")
    }

    await tx.$executeRaw`
      INSERT INTO kiosk_sessions (
        public_id,
        kiosk_id,
        station_id,
        approved_by_user_id,
        role_scope,
        permissions_json,
        status,
        started_at,
        expires_at,
        last_heartbeat_at
      )
      VALUES (
        ${sessionPublicId},
        ${challenge.kiosk_id},
        ${challenge.station_id},
        ${auth.userId},
        ${approval.roleScope},
        ${permissionsJson},
        'ACTIVE',
        CURRENT_TIMESTAMP(3),
        ${expiresAt},
        CURRENT_TIMESTAMP(3)
      )
    `

    await tx.$executeRaw`
      UPDATE kiosk_login_challenges
      SET
        status = 'APPROVED',
        approved_by_user_id = ${auth.userId},
        approved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${challenge.id}
    `
  })

  await writeSecurityAuditLog({
    actorId: auth.userId,
    action: "KIOSK_CHALLENGE_APPROVED",
    entityType: "KioskLoginChallenge",
    entityId: challenge.public_id,
    metadata: {
      kioskSessionId: sessionPublicId,
      stationId: String(challenge.station_id),
      kioskId: String(challenge.kiosk_id),
      roleScope: approval.roleScope,
      permissions: approval.permissions,
    },
    req,
  })
  await writeKioskStationAuditLog({
    stationId: challenge.station_id,
    actorStaffId: approval.staff?.staff_id || null,
    actionType: "KIOSK_CHALLENGE_APPROVED",
    payload: {
      challengeId: challenge.public_id,
      kioskSessionId: sessionPublicId,
      displayCode: challenge.display_code,
      roleScope: approval.roleScope,
    },
  })

  return {
    approved: true,
    sessionId: sessionPublicId,
    roleScope: approval.roleScope,
    permissions: approval.permissions,
    expiresAt,
  }
}

export async function denyChallenge({ challengeId, auth, req }) {
  const loaded = await loadChallenge(challengeId)
  if (!loaded?.id) throw notFound("Kiosk challenge not found")
  const challenge = await markChallengeExpiredIfNeeded(loaded)
  const approval = await assertApproverForChallenge({
    auth,
    challenge,
    req,
    action: "DENY",
  })

  if (String(challenge.status || "").toUpperCase() !== "PENDING") {
    throw badRequest("Kiosk challenge is no longer pending")
  }

  await prisma.$executeRaw`
    UPDATE kiosk_login_challenges
    SET status = 'DENIED', denied_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${challenge.id}
      AND status = 'PENDING'
  `

  await writeSecurityAuditLog({
    actorId: auth.userId,
    action: "KIOSK_CHALLENGE_DENIED",
    entityType: "KioskLoginChallenge",
    entityId: challenge.public_id,
    metadata: {
      stationId: String(challenge.station_id),
      kioskId: String(challenge.kiosk_id),
    },
    req,
  })
  await writeKioskStationAuditLog({
    stationId: challenge.station_id,
    actorStaffId: approval.staff?.staff_id || null,
    actionType: "KIOSK_CHALLENGE_DENIED",
    payload: {
      challengeId: challenge.public_id,
      displayCode: challenge.display_code,
    },
  })

  return {
    denied: true,
  }
}

export async function expireStaleKioskSessions() {
  const idleCutoff = addMinutes(new Date(), -IDLE_TIMEOUT_MINUTES)
  await prisma.$executeRaw`
    UPDATE kiosk_sessions
    SET status = 'EXPIRED'
    WHERE status = 'ACTIVE'
      AND (
        expires_at <= CURRENT_TIMESTAMP(3)
        OR COALESCE(last_heartbeat_at, started_at) < ${idleCutoff}
      )
  `
}

export async function getActiveKioskSessionForAuth({ sessionPublicId, userId, stationId }) {
  await expireStaleKioskSessions()
  const rows = await prisma.$queryRaw`
    SELECT
      ks.public_id,
      ks.kiosk_id,
      ks.station_id,
      ks.approved_by_user_id,
      ks.role_scope,
      ks.permissions_json,
      ks.status,
      ks.started_at,
      ks.expires_at,
      ks.last_heartbeat_at,
      u.public_id AS approved_by_public_id,
      u.full_name AS approved_by_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      kd.kiosk_code,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.assigned_pump_id,
      kd.allowed_modes_json,
      p.public_id AS assigned_pump_public_id,
      p.pump_number AS assigned_pump_number,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS assigned_pump_name,
      pc.current_mode
    FROM kiosk_sessions ks
    INNER JOIN users u ON u.id = ks.approved_by_user_id
    INNER JOIN stations st ON st.id = ks.station_id
    INNER JOIN kiosk_devices kd ON kd.id = ks.kiosk_id
    LEFT JOIN pumps p ON p.id = kd.assigned_pump_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    WHERE ks.public_id = ${sessionPublicId}
      AND ks.approved_by_user_id = ${userId}
      AND ks.station_id = ${stationId}
      AND ks.status = 'ACTIVE'
      AND ks.expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  return rows?.[0] || null
}

export function mapKioskAuthContext(session) {
  return {
    userPublicId: session.approved_by_public_id,
    userId: Number(session.approved_by_user_id),
    stationPublicId: session.station_public_id,
    stationId: Number(session.station_id),
    role: String(session.role_scope || "ATTENDANT").toUpperCase(),
    sessionPublicId: session.public_id,
    sessionType: "KIOSK",
    kioskSessionPublicId: session.public_id,
    kioskId: Number(session.kiosk_id),
    kioskName: session.kiosk_name || "Station kiosk",
    assignedPumpId: session.assigned_pump_id ? Number(session.assigned_pump_id) : null,
    assignedPumpPublicId: session.assigned_pump_public_id || null,
    assignedPumpNumber: session.assigned_pump_number === null || session.assigned_pump_number === undefined
      ? null
      : Number(session.assigned_pump_number),
    assignedPumpName: session.assigned_pump_name || null,
    pumpMode: session.current_mode || "OPEN_WALKIN",
    allowedModes: safeJsonParseArray(session.allowed_modes_json),
    kioskPermissions: safeJsonParseArray(session.permissions_json),
  }
}

function kioskConfigurationError() {
  return badRequest("This kiosk is not assigned to a pump. Ask manager to configure it.")
}

function assertKioskSession(auth) {
  if (auth?.sessionType !== "KIOSK") {
    throwForbidden("Kiosk session is required")
  }
  if (!auth?.stationId || !auth?.kioskId) {
    throwForbidden("Kiosk session context is incomplete")
  }
}

function assertKioskAssignedPump(auth) {
  assertKioskSession(auth)
  if (!auth.assignedPumpId) {
    throw kioskConfigurationError()
  }
}

function normalizePumpMode(value) {
  const mode = String(value || "").trim().toUpperCase()
  if (["OPEN_WALKIN", "CLEARING_FOR_SMARTLINK", "SMARTLINK_ONLY", "PAUSED", "MAINTENANCE"].includes(mode)) {
    return mode
  }
  throw badRequest("Pump mode is not valid")
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function mapKioskQueueTicket(row) {
  return {
    id: row.public_id,
    status: row.status,
    operationalStatus:
      row.pump_assignment_status === "MANUAL_REVIEW_REQUIRED"
        ? "MANUAL_REVIEW_REQUIRED"
        : row.status === "CALLED"
          ? "CALLED_TO_STATION"
          : row.assigned_pump_id
            ? "PUMP_ASSIGNED"
            : row.status,
    position: row.position === null || row.position === undefined ? null : Number(row.position),
    fuelType: row.fuel_type || null,
    maskedPlate: row.masked_plate || row.number_plate || null,
    vehicle: row.vehicle_public_id
      ? {
          id: row.vehicle_public_id,
          make: row.make || "",
          model: row.model || "",
          numberPlate: row.number_plate || row.masked_plate || "",
          tankSide: row.tank_side || "UNKNOWN",
          vehicleType: row.vehicle_type || "OTHER",
        }
      : null,
    pumpAssignment: {
      status: row.pump_assignment_status || "PENDING",
      reason: row.assignment_reason || null,
      confidence: row.assignment_confidence || null,
      lockedAt: toIsoOrNull(row.assignment_locked_at),
    },
    joinedAt: toIsoOrNull(row.joined_at),
    calledAt: toIsoOrNull(row.called_at),
  }
}

export async function getKioskMe({ auth }) {
  assertKioskSession(auth)
  return {
    sessionType: "KIOSK",
    sessionId: auth.kioskSessionPublicId,
    role: auth.role,
    permissions: auth.kioskPermissions || [],
    station: {
      id: auth.stationPublicId,
      internalId: auth.stationId,
    },
    kiosk: {
      id: auth.kioskId,
      name: auth.kioskName,
    },
    assignedPump: auth.assignedPumpId
      ? {
          internalId: auth.assignedPumpId,
          id: auth.assignedPumpPublicId,
          pumpNumber: auth.assignedPumpNumber,
          displayName: auth.assignedPumpName || `Pump ${auth.assignedPumpNumber || ""}`.trim(),
          currentMode: auth.pumpMode || "OPEN_WALKIN",
        }
      : null,
    configurationRequired: !auth.assignedPumpId,
    configurationMessage: !auth.assignedPumpId
      ? "This kiosk is not assigned to a pump. Ask manager to configure it."
      : null,
  }
}

async function loadKioskScopedQueue(auth, { limit = 50 } = {}) {
  assertKioskAssignedPump(auth)
  return prisma.$queryRaw`
    SELECT
      qe.public_id,
      qe.masked_plate,
      qe.position,
      qe.status,
      qe.joined_at,
      qe.called_at,
      qe.assigned_pump_id,
      qe.pump_assignment_status,
      qe.assignment_reason,
      qe.assignment_confidence,
      qe.assignment_locked_at,
      ft.code AS fuel_type,
      v.public_id AS vehicle_public_id,
      v.make,
      v.model,
      v.vehicle_type,
      v.number_plate,
      v.tank_side
    FROM queue_entries qe
    LEFT JOIN fuel_types ft ON ft.id = qe.fuel_type_id
    LEFT JOIN vehicles v ON v.id = qe.vehicle_id
    WHERE qe.station_id = ${auth.stationId}
      AND qe.assigned_pump_id = ${auth.assignedPumpId}
      AND qe.status IN ('WAITING', 'CALLED', 'LATE')
    ORDER BY
      CASE qe.status WHEN 'CALLED' THEN 0 WHEN 'WAITING' THEN 1 WHEN 'LATE' THEN 2 ELSE 5 END,
      qe.position ASC,
      qe.joined_at ASC
    LIMIT ${Number(limit || 50)}
  `
}

export async function getKioskQueue({ auth }) {
  const rows = await loadKioskScopedQueue(auth)
  return {
    assignedPumpId: auth.assignedPumpPublicId || null,
    tickets: (rows || []).map(mapKioskQueueTicket),
  }
}

export async function getKioskPumpHome({ auth }) {
  assertKioskAssignedPump(auth)
  const [pumpRows, queueRows, sessionRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        p.public_id,
        p.pump_number,
        COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS display_name,
        COALESCE(pc.current_mode, 'OPEN_WALKIN') AS current_mode,
        COALESCE(pc.lane_side_supported, 'BOTH_SIDES') AS lane_side_supported,
        COALESCE(pc.is_smartlink_enabled, 0) AS is_smartlink_enabled
      FROM pumps p
      LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
      WHERE p.station_id = ${auth.stationId}
        AND p.id = ${auth.assignedPumpId}
      LIMIT 1
    `,
    loadKioskScopedQueue(auth, { limit: 8 }),
    prisma.$queryRaw`
      SELECT public_id, session_status, start_time, updated_at, dispensed_litres
      FROM pump_sessions
      WHERE station_id = ${auth.stationId}
        AND pump_id = ${auth.assignedPumpId}
        AND session_status IN ('STARTED', 'DISPENSING')
      ORDER BY COALESCE(updated_at, start_time, created_at) DESC, id DESC
      LIMIT 1
    `.catch(() => []),
  ])
  const pump = pumpRows?.[0] || null
  const tickets = (queueRows || []).map(mapKioskQueueTicket)
  return {
    pump: pump
      ? {
          id: pump.public_id,
          pumpNumber: Number(pump.pump_number || 0),
          displayName: pump.display_name || `Pump ${pump.pump_number}`,
          currentMode: pump.current_mode || "OPEN_WALKIN",
          laneSideSupported: pump.lane_side_supported || "BOTH_SIDES",
          isSmartlinkEnabled: Boolean(pump.is_smartlink_enabled),
        }
      : null,
    current: tickets.find((ticket) => ticket.status === "CALLED") || null,
    next: tickets.filter((ticket) => ticket.status !== "CALLED").slice(0, 3),
    manualReview: tickets.filter((ticket) => ticket.pumpAssignment.status === "MANUAL_REVIEW_REQUIRED"),
    activeSession: sessionRows?.[0]
      ? {
          id: sessionRows[0].public_id,
          status: sessionRows[0].session_status,
          startedAt: toIsoOrNull(sessionRows[0].start_time),
          updatedAt: toIsoOrNull(sessionRows[0].updated_at),
          dispensedLitres: Number(sessionRows[0].dispensed_litres || 0),
        }
      : null,
  }
}

export async function updateKioskPumpMode({ auth, mode, reason = null }) {
  assertKioskAssignedPump(auth)
  const normalizedMode = normalizePumpMode(mode)
  const allowedModes = Array.isArray(auth.allowedModes) ? auth.allowedModes : []
  if (allowedModes.length && !allowedModes.includes(normalizedMode)) {
    throwForbidden("Kiosk is not allowed to set this pump mode")
  }
  await prisma.$executeRaw`
    UPDATE pump_configurations
    SET current_mode = ${normalizedMode},
        updated_at = CURRENT_TIMESTAMP(3)
    WHERE station_id = ${auth.stationId}
      AND pump_id = ${auth.assignedPumpId}
  `
  await writeOperationalAudit({
    actorType: "KIOSK",
    actorId: auth.kioskId,
    stationId: auth.stationId,
    pumpId: auth.assignedPumpId,
    kioskId: auth.kioskId,
    action: "PUMP_MODE_CHANGED",
    reason: reason || `Pump mode changed to ${normalizedMode}.`,
    metadata: { mode: normalizedMode, kioskSessionId: auth.kioskSessionPublicId },
  })
  return getKioskPumpHome({ auth: { ...auth, pumpMode: normalizedMode } })
}

async function loadKioskTicketOrThrow(auth, ticketId) {
  assertKioskAssignedPump(auth)
  const scopedTicketId = String(ticketId || "").trim()
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, station_id, assigned_pump_id, status, metadata
    FROM queue_entries
    WHERE public_id = ${scopedTicketId}
      AND station_id = ${auth.stationId}
    LIMIT 1
  `
  const ticket = rows?.[0]
  if (!ticket?.id) throw notFound("Queue ticket not found")
  if (String(ticket.assigned_pump_id || "") !== String(auth.assignedPumpId || "")) {
    await writeOperationalAudit({
      actorType: "KIOSK",
      actorId: auth.kioskId,
      stationId: auth.stationId,
      pumpId: auth.assignedPumpId,
      kioskId: auth.kioskId,
      queueTicketId: ticket.id,
      action: "KIOSK_UNAUTHORIZED_PUMP_ACTION",
      reason: "Kiosk tried to act on a ticket assigned to another pump.",
      metadata: { ticketId: scopedTicketId, ticketPumpId: ticket.assigned_pump_id ? String(ticket.assigned_pump_id) : null },
    })
    throwForbidden("Kiosk cannot act on another pump's ticket")
  }
  return ticket
}

export async function performKioskTicketAction({ auth, ticketId, action, payload = {} }) {
  const normalizedAction = String(action || "").trim().toUpperCase().replace(/-/g, "_")
  const ticket = await loadKioskTicketOrThrow(auth, ticketId)
  const metadata = parseJsonObject(ticket.metadata)
  metadata.kioskActions = {
    ...(metadata.kioskActions || {}),
    [normalizedAction]: {
      at: new Date().toISOString(),
      kioskId: auth.kioskId,
      note: String(payload?.note || "").trim() || null,
    },
  }

  let statusUpdate = null
  let servedAtSql = null
  if (normalizedAction === "MARK_ARRIVED") {
    metadata.customerArrivedAt = metadata.customerArrivedAt || new Date().toISOString()
  } else if (normalizedAction === "START_FUELING") {
    metadata.serviceRequest = {
      ...(metadata.serviceRequest || {}),
      dispensingStartedAt: new Date().toISOString(),
      pumpPublicId: auth.assignedPumpPublicId || null,
    }
  } else if (normalizedAction === "COMPLETE") {
    statusUpdate = "SERVED"
    servedAtSql = new Date()
  } else if (normalizedAction === "NO_SHOW") {
    statusUpdate = "NO_SHOW"
  } else if (normalizedAction === "SKIP") {
    statusUpdate = "LATE"
  } else if (normalizedAction === "DISPUTE") {
    metadata.dispute = {
      at: new Date().toISOString(),
      reason: String(payload?.reason || payload?.note || "Disputed at pump").slice(0, 255),
      kioskId: auth.kioskId,
    }
  } else if (normalizedAction === "BLOCKED_LANE") {
    metadata.blockedLane = {
      at: new Date().toISOString(),
      note: String(payload?.note || "").slice(0, 255) || null,
      kioskId: auth.kioskId,
    }
  } else {
    throw badRequest("Ticket action is not supported")
  }

  await prisma.$executeRaw`
    UPDATE queue_entries
    SET status = COALESCE(${statusUpdate}, status),
        served_at = COALESCE(${servedAtSql}, served_at),
        pump_assignment_status = CASE
          WHEN ${normalizedAction} IN ('MARK_ARRIVED', 'START_FUELING') THEN 'LOCKED'
          ELSE pump_assignment_status
        END,
        assignment_locked_at = CASE
          WHEN ${normalizedAction} IN ('MARK_ARRIVED', 'START_FUELING') THEN COALESCE(assignment_locked_at, CURRENT_TIMESTAMP(3))
          ELSE assignment_locked_at
        END,
        metadata = ${JSON.stringify(metadata)},
        last_moved_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${ticket.id}
  `

  if (normalizedAction === "BLOCKED_LANE") {
    await updateKioskPumpMode({ auth, mode: "CLEARING_FOR_SMARTLINK", reason: "Lane marked blocked from kiosk." })
  }

  await writeOperationalAudit({
    actorType: "KIOSK",
    actorId: auth.kioskId,
    stationId: auth.stationId,
    pumpId: auth.assignedPumpId,
    kioskId: auth.kioskId,
    queueTicketId: ticket.id,
    action: `KIOSK_${normalizedAction}`,
    reason: payload?.reason || payload?.note || null,
    metadata: { ticketId, kioskSessionId: auth.kioskSessionPublicId },
  })

  return getKioskPumpHome({ auth })
}

export async function heartbeatSession({ sessionId, auth }) {
  if (auth?.sessionType !== "KIOSK" || auth?.kioskSessionPublicId !== sessionId) {
    throwForbidden("Kiosk heartbeat requires the active kiosk session")
  }

  await prisma.$executeRaw`
    UPDATE kiosk_sessions
    SET last_heartbeat_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${sessionId}
      AND status = 'ACTIVE'
      AND expires_at > CURRENT_TIMESTAMP(3)
  `

  const session = await getActiveKioskSessionForAuth({
    sessionPublicId: sessionId,
    userId: auth.userId,
    stationId: auth.stationId,
  })
  if (!session?.public_id) {
    return { status: "expired" }
  }

  return {
    status: "active",
    expiresAt: session.expires_at,
    lastHeartbeatAt: new Date(),
  }
}

function assertManagerSession(auth) {
  if (auth?.sessionType === "KIOSK") {
    throwForbidden("Kiosk sessions cannot manage kiosk sessions")
  }
  const role = normalizeRole(auth?.role)
  if (!MANAGER_ROLES.has(role)) {
    throwForbidden("Manager access is required")
  }
  if (!auth?.stationId) {
    throwForbidden("Station manager scope is required")
  }
}

export async function listActiveSessions({ auth }) {
  assertManagerSession(auth)
  await expireStaleKioskSessions()
  const rows = await prisma.$queryRaw`
    SELECT
      ks.public_id,
      ks.status,
      ks.role_scope,
      ks.permissions_json,
      ks.started_at,
      ks.expires_at,
      ks.last_heartbeat_at,
      u.public_id AS approved_by_public_id,
      u.full_name AS approved_by_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      kd.kiosk_code,
      kd.name AS kiosk_name,
      kd.location_label,
      kd.assigned_pump_id,
      kd.allowed_modes_json,
      p.public_id AS assigned_pump_public_id,
      p.pump_number AS assigned_pump_number,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS assigned_pump_name,
      pc.current_mode
    FROM kiosk_sessions ks
    INNER JOIN users u ON u.id = ks.approved_by_user_id
    INNER JOIN stations st ON st.id = ks.station_id
    INNER JOIN kiosk_devices kd ON kd.id = ks.kiosk_id
    LEFT JOIN pumps p ON p.id = kd.assigned_pump_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    WHERE ks.station_id = ${auth.stationId}
      AND ks.status = 'ACTIVE'
      AND ks.expires_at > CURRENT_TIMESTAMP(3)
    ORDER BY ks.started_at DESC
  `

  return {
    sessions: (rows || []).map((row) => mapKioskSession(row)),
  }
}

export async function revokeSession({ sessionId, auth, req }) {
  await expireStaleKioskSessions()

  if (auth?.sessionType === "KIOSK") {
    if (auth.kioskSessionPublicId !== sessionId) {
      throwForbidden("Kiosk can only lock its own session")
    }
    if (!auth.kioskPermissions?.includes("LOCK_KIOSK")) {
      throwForbidden("Kiosk session cannot lock itself")
    }
    await prisma.$executeRaw`
      UPDATE kiosk_sessions
      SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(3), revoked_by_user_id = ${auth.userId}
      WHERE public_id = ${sessionId}
        AND status = 'ACTIVE'
    `
    await writeSecurityAuditLog({
      actorId: auth.userId,
      action: "KIOSK_SESSION_SELF_REVOKED",
      entityType: "KioskSession",
      entityId: sessionId,
      metadata: { stationId: String(auth.stationId), kioskId: String(auth.kioskId) },
      req,
    })
    await writeKioskStationAuditLog({
      stationId: auth.stationId,
      actionType: "KIOSK_SESSION_SELF_REVOKED",
      payload: { sessionId, kioskId: auth.kioskId },
    })
    return { revoked: true }
  }

  assertManagerSession(auth)
  const rows = await prisma.$queryRaw`
    SELECT public_id, station_id, status
    FROM kiosk_sessions
    WHERE public_id = ${sessionId}
      AND station_id = ${auth.stationId}
    LIMIT 1
  `
  const session = rows?.[0] || null
  if (!session?.public_id) throw notFound("Kiosk session not found")
  if (String(session.status || "").toUpperCase() !== "ACTIVE") {
    return { revoked: false, status: toStatus(session.status) }
  }

  await prisma.$executeRaw`
    UPDATE kiosk_sessions
    SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(3), revoked_by_user_id = ${auth.userId}
    WHERE public_id = ${sessionId}
      AND station_id = ${auth.stationId}
      AND status = 'ACTIVE'
  `

  await writeSecurityAuditLog({
    actorId: auth.userId,
    action: "KIOSK_SESSION_REVOKED",
    entityType: "KioskSession",
    entityId: sessionId,
    metadata: { stationId: String(auth.stationId) },
    req,
  })
  await writeKioskStationAuditLog({
    stationId: auth.stationId,
    actionType: "KIOSK_SESSION_REVOKED",
    payload: { sessionId, revokedByUserId: auth.userId },
  })

  return { revoked: true }
}

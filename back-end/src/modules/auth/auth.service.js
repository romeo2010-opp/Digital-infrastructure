import bcrypt from "bcryptjs"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { prisma } from "../../db/prisma.js"
import { formatDateTimeSqlInTimeZone, toUtcMysqlDateTime } from "../../utils/dateTime.js"
import { generatePublicUserId } from "../../utils/generateUserId.js"
import { badRequest, unauthorized } from "../../utils/http.js"
import { createPublicId, writeAuditLog } from "../common/db.js"
import {
  assertStationSubscriptionAccess,
  evaluateStationSubscriptionAccess,
} from "./stationSubscriptionAccess.js"
import { toStationSubscriptionSummary } from "../subscriptions/planCatalog.js"
import {
  buildUserHandle,
  extractClientDataChallenge,
  randomBase64Url,
  resolveWebAuthnContext,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "./auth.passkeys.js"

const ACCESS_TOKEN_TTL_MIN = Number(process.env.ACCESS_TOKEN_TTL_MIN || 480)
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30)
const PASSKEY_CHALLENGE_TTL_MIN = Number(process.env.PASSKEY_CHALLENGE_TTL_MIN || 10)

function now() {
  return new Date()
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function utcNowSql() {
  return toUtcMysqlDateTime(now())
}

function utcSqlDateTime(value) {
  return toUtcMysqlDateTime(value)
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString("base64url")
}

function readClientMeta(req) {
  return {
    userAgent: req.header("user-agent")?.slice(0, 255) || null,
    ipAddress: (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
  }
}

function signAccessToken(identity) {
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) throw badRequest("JWT access secret is not configured")

  return jwt.sign(
    {
      sub: identity.userPublicId,
      uid: identity.userId,
      stationPublicId: identity.stationPublicId,
      stationId: identity.stationId,
      role: identity.role,
      sid: identity.sessionPublicId,
    },
    secret,
    {
      expiresIn: `${ACCESS_TOKEN_TTL_MIN}m`,
    }
  )
}

async function getUserByCredentials({ email, phone }) {
  if (email) {
    const rows = await prisma.$queryRaw`
      SELECT id, public_id, full_name, email, phone_e164, password_hash, is_active
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `
    return rows?.[0] || null
  }

  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, email, phone_e164, password_hash, is_active
    FROM users
    WHERE phone_e164 = ${phone}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function getActiveStationStaff(userId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ss.id AS staff_id,
      ss.role_id,
      st.id AS station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      sr.code AS role_code,
      sss.plan_code,
      sss.plan_name,
      sss.monthly_fee_mwk,
      sss.status AS subscription_status,
      sss.renewal_date AS subscription_renewal_date
    FROM station_staff ss
    INNER JOIN stations st ON st.id = ss.station_id
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    LEFT JOIN station_subscription_statuses sss ON sss.station_id = st.id
    WHERE ss.user_id = ${userId}
      AND ss.is_active = 1
      AND st.is_active = 1
      AND st.deleted_at IS NULL
    ORDER BY ss.id ASC
  `

  return (
    (rows || []).find((row) =>
      evaluateStationSubscriptionAccess({
        station_name: row.station_name,
        timezone: row.station_timezone,
        status: row.subscription_status,
        renewal_date: row.subscription_renewal_date,
      }).allowed
    ) || null
  )
}

async function listStationStaffMembershipsWithAccess(userId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ss.id AS staff_id,
      ss.role_id,
      st.id AS station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      sr.code AS role_code,
      sss.plan_code,
      sss.plan_name,
      sss.monthly_fee_mwk,
      sss.status AS subscription_status,
      sss.renewal_date AS subscription_renewal_date
    FROM station_staff ss
    INNER JOIN stations st ON st.id = ss.station_id
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    LEFT JOIN station_subscription_statuses sss ON sss.station_id = st.id
    WHERE ss.user_id = ${userId}
      AND ss.is_active = 1
      AND st.is_active = 1
      AND st.deleted_at IS NULL
    ORDER BY st.name ASC, ss.id ASC
  `

  return (rows || []).map((row) => {
    const subscriptionAccess = evaluateStationSubscriptionAccess({
      station_name: row.station_name,
      timezone: row.station_timezone,
      status: row.subscription_status,
      renewal_date: row.subscription_renewal_date,
    })

    return {
      staffId: Number(row.staff_id),
      roleId: Number(row.role_id),
      stationId: Number(row.station_id),
      stationPublicId: normalizeOptional(row.station_public_id),
      stationName: normalizeOptional(row.station_name),
      stationTimeZone: normalizeOptional(row.station_timezone),
      roleCode: normalizeOptional(row.role_code) || "VIEWER",
      subscription: toStationSubscriptionSummary({
        plan_code: row.plan_code,
        plan_name: row.plan_name,
        monthly_fee_mwk: row.monthly_fee_mwk,
        status: row.subscription_status,
        renewal_date: row.subscription_renewal_date,
      }),
      subscriptionAccess,
    }
  })
}

async function listActiveStationStaffMemberships(userId) {
  const memberships = await listStationStaffMembershipsWithAccess(userId)
  return memberships.filter((membership) => membership.subscriptionAccess.allowed)
}

function mapStationMemberships(memberships = [], currentStationPublicId = null) {
  return memberships.map((membership) => ({
    station: membership.stationPublicId
      ? {
          publicId: membership.stationPublicId,
          name: membership.stationName || "Station",
          timezone: membership.stationTimeZone || "Africa/Blantyre",
          subscription: membership.subscription || null,
        }
      : null,
    role: membership.roleCode || "VIEWER",
    isCurrent: membership.stationPublicId === currentStationPublicId,
  }))
}

function normalizeOptional(value) {
  const scoped = String(value || "").trim()
  return scoped || null
}

function toNullableId(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) return null
  return normalized
}

async function writeAuthAuditLogIfPossible({ stationId, actionType, payload }) {
  const scopedStationId = toNullableId(stationId)
  if (!scopedStationId) return

  await writeAuditLog({
    stationId: scopedStationId,
    actionType,
    payload,
  })
}

async function findExistingUserByIdentity({ email, phone }) {
  if (!email && !phone) return null

  const rows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE (${email} IS NOT NULL AND email = ${email})
      OR (${phone} IS NOT NULL AND phone_e164 = ${phone})
    LIMIT 1
  `

  return rows?.[0] || null
}

async function getDefaultRegistrationStation() {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name
    FROM stations
    WHERE is_active = 1
    ORDER BY
      CASE
        WHEN LOWER(COALESCE(city, '')) = 'blantyre' THEN 0
        ELSE 1
      END ASC,
      id ASC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveStationTimeZone(stationId) {
  if (!stationId) return "Africa/Blantyre"
  const rows = await prisma.$queryRaw`
    SELECT timezone
    FROM stations
    WHERE id = ${stationId}
    LIMIT 1
  `
  return String(rows?.[0]?.timezone || "").trim() || "Africa/Blantyre"
}

function serializeDateForTimeZone(value, timeZone) {
  if (!(value instanceof Date)) return value
  return formatDateTimeSqlInTimeZone(value, timeZone) || value.toISOString()
}

async function getUserById(userId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, email, phone_e164, password_hash, is_active
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function listUserPasskeys(userId) {
  const rows = await prisma.$queryRaw`
    SELECT
      public_id,
      credential_id,
      label,
      public_key_pem,
      sign_count,
      transports_json,
      last_used_at,
      created_at
    FROM user_passkeys
    WHERE user_id = ${userId}
    ORDER BY created_at ASC, id ASC
  `

  return (rows || []).map((row) => ({
    publicId: row.public_id,
    credentialId: row.credential_id,
    label: normalizeOptional(row.label) || null,
    publicKeyPem: row.public_key_pem,
    signCount: Number(row.sign_count || 0),
    transports: parseOptionalJsonArray(row.transports_json),
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at || null,
  }))
}

function parseOptionalJsonArray(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function createPasskeyChallenge({
  userId = null,
  purpose,
  challenge,
  origin,
  rpId,
}) {
  const challengePublicId = createPublicId()
  const expiresAt = addMinutes(now(), PASSKEY_CHALLENGE_TTL_MIN)
  const expiresAtSql = utcSqlDateTime(expiresAt)

  await prisma.$executeRaw`
    INSERT INTO user_passkey_challenges (
      public_id,
      user_id,
      purpose,
      challenge,
      origin,
      rp_id,
      expires_at
    )
    VALUES (
      ${challengePublicId},
      ${userId},
      ${purpose},
      ${challenge},
      ${origin},
      ${rpId},
      ${expiresAtSql}
    )
  `

  return {
    challengePublicId,
    expiresAt,
  }
}

async function getActivePasskeyChallenge({ challengePublicId, purpose, userId = undefined }) {
  const currentUtcSql = utcNowSql()
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, user_id, purpose, challenge, origin, rp_id, expires_at
    FROM user_passkey_challenges
    WHERE public_id = ${challengePublicId}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > ${currentUtcSql}
      AND (${userId === undefined ? null : userId} IS NULL OR user_id <=> ${userId === undefined ? null : userId})
    ORDER BY id DESC
    LIMIT 1
  `

  return rows?.[0] || null
}

async function getActivePasskeyChallengeByChallengeValue({ challenge, purpose, userId = undefined }) {
  const currentUtcSql = utcNowSql()
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, user_id, purpose, challenge, origin, rp_id, expires_at
    FROM user_passkey_challenges
    WHERE challenge = ${challenge}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > ${currentUtcSql}
      AND (${userId === undefined ? null : userId} IS NULL OR user_id <=> ${userId === undefined ? null : userId})
    ORDER BY id DESC
    LIMIT 1
  `

  return rows?.[0] || null
}

async function markPasskeyChallengeUsed(challengeId) {
  const usedAtSql = utcNowSql()
  await prisma.$executeRaw`
    UPDATE user_passkey_challenges
    SET used_at = ${usedAtSql}
    WHERE id = ${challengeId}
  `
}

async function getPasskeyByCredentialId(credentialId) {
  const rows = await prisma.$queryRaw`
    SELECT
      pk.id,
      pk.public_id,
      pk.user_id,
      pk.credential_id,
      pk.public_key_pem,
      pk.sign_count,
      pk.label,
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      u.email AS user_email,
      u.phone_e164 AS user_phone,
      u.password_hash,
      u.is_active
    FROM user_passkeys pk
    INNER JOIN users u ON u.id = pk.user_id
    WHERE pk.credential_id = ${credentialId}
    LIMIT 1
  `

  return rows?.[0] || null
}

async function createUserPasskey({
  userId,
  credentialId,
  publicKeyPem,
  signCount,
  label = null,
  transports = [],
}) {
  const passkeyPublicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO user_passkeys (
      public_id,
      user_id,
      credential_id,
      public_key_pem,
      sign_count,
      label,
      transports_json
    )
    VALUES (
      ${passkeyPublicId},
      ${userId},
      ${credentialId},
      ${publicKeyPem},
      ${signCount},
      ${label},
      ${JSON.stringify(Array.isArray(transports) ? transports : [])}
    )
  `

  return passkeyPublicId
}

async function touchUserPasskey({ passkeyId, signCount }) {
  await prisma.$executeRaw`
    UPDATE user_passkeys
    SET
      sign_count = ${signCount},
      last_used_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${passkeyId}
  `
}

async function getUserPasskeyByPublicId({ userId, passkeyPublicId }) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, label, credential_id
    FROM user_passkeys
    WHERE user_id = ${userId}
      AND public_id = ${passkeyPublicId}
    LIMIT 1
  `

  return rows?.[0] || null
}

async function createLoginResultForUser({ user, req }) {
  const stationMembershipsWithAccess = await listStationStaffMembershipsWithAccess(user.id)
  const memberships = stationMembershipsWithAccess.filter((membership) => membership.subscriptionAccess.allowed)
  if (stationMembershipsWithAccess.length > 0 && memberships.length === 0) {
    throw unauthorized(
      stationMembershipsWithAccess[0]?.subscriptionAccess?.message ||
        "The station subscription has expired. Renew it before signing in again."
    )
  }

  const staff = memberships[0] || null
  const isStaffUser = Boolean(staff?.stationId)
  const scopedStationId = isStaffUser ? toNullableId(staff.stationId) : null
  const scopedRoleId = isStaffUser ? toNullableId(staff.roleId) : null
  const scopedStationPublicId = isStaffUser ? normalizeOptional(staff.stationPublicId) : null
  const scopedStationName = isStaffUser ? normalizeOptional(staff.stationName) : null
  const scopedStationTimeZone = isStaffUser ? normalizeOptional(staff.stationTimeZone) : null
  const scopedRoleCode = isStaffUser ? normalizeOptional(staff.roleCode) || "VIEWER" : "USER"

  const refreshToken = createRefreshToken()
  const refreshTokenHash = hashToken(refreshToken)
  const session = await createSession({
    userId: user.id,
    stationId: scopedStationId,
    roleId: scopedRoleId,
    refreshTokenHash,
    req,
  })

  await writeAuthAuditLogIfPossible({
    stationId: scopedStationId,
    actionType: "AUTH_LOGIN",
    payload: {
      userPublicId: user.public_id,
      sessionPublicId: session.sessionPublicId,
      ip: session.meta.ipAddress,
      userAgent: session.meta.userAgent,
      role: scopedRoleCode,
    },
  })

  const accessToken = signAccessToken({
    userPublicId: user.public_id,
    userId: Number(user.id),
    stationPublicId: scopedStationPublicId,
    stationId: scopedStationId,
    role: scopedRoleCode,
    sessionPublicId: session.sessionPublicId,
  })

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: session.expiresAt,
    user: {
      publicId: user.public_id,
      fullName: user.full_name,
    },
    station: scopedStationPublicId
      ? {
          publicId: scopedStationPublicId,
          name: scopedStationName || "Station",
          timezone: scopedStationTimeZone || "Africa/Blantyre",
          subscription: staff?.subscription || null,
        }
      : null,
    role: scopedRoleCode,
    stationMemberships: mapStationMemberships(memberships, scopedStationPublicId),
  }
}

export async function register({ payload, req }) {
  const email = normalizeOptional(payload?.email)?.toLowerCase() || null
  const phone = normalizeOptional(payload?.phone)
  const fullName = normalizeOptional(payload?.fullName)
  const password = String(payload?.password || "")

  const existing = await findExistingUserByIdentity({ email, phone })
  if (existing?.id) throw badRequest("An account with this email/phone already exists")

  const station = await getDefaultRegistrationStation()

  const userPublicId = await generatePublicUserId()
  const passwordHash = await bcrypt.hash(password, 10)

  await prisma.$executeRaw`
    INSERT INTO users (
      public_id,
      full_name,
      phone_e164,
      email,
      password_hash,
      is_active
    )
    VALUES (
      ${userPublicId},
      ${fullName},
      ${phone},
      ${email},
      ${passwordHash},
      1
    )
  `

  const userRows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE public_id = ${userPublicId}
    LIMIT 1
  `
  const userId = Number(userRows?.[0]?.id || 0)
  if (!Number.isFinite(userId) || userId <= 0) {
    throw badRequest("Failed to provision user account")
  }

  await writeAuthAuditLogIfPossible({
    stationId: station?.id || null,
    actionType: "AUTH_REGISTER",
    payload: {
      userPublicId,
      email,
      phone,
      ip: readClientMeta(req).ipAddress,
    },
  })

  return login({
    credentials: {
      email: email || undefined,
      phone: phone || undefined,
      password,
    },
    req,
  })
}

async function createSession({ userId, stationId, roleId, refreshTokenHash, req }) {
  const sessionPublicId = createPublicId()
  const expiresAt = addDays(now(), REFRESH_TOKEN_TTL_DAYS)
  const meta = readClientMeta(req)

  await prisma.$executeRaw`
    INSERT INTO auth_sessions (
      public_id, user_id, station_id, role_id, refresh_token_hash, user_agent, ip_address, expires_at
    )
    VALUES (
      ${sessionPublicId},
      ${userId},
      ${stationId},
      ${roleId},
      ${refreshTokenHash},
      ${meta.userAgent},
      ${meta.ipAddress},
      ${expiresAt}
    )
  `

  return {
    sessionPublicId,
    expiresAt,
    meta,
  }
}

async function revokeSessionByHash(refreshTokenHash) {
  const rows = await prisma.$queryRaw`
    SELECT s.id, s.public_id, s.station_id, s.user_id, u.public_id AS user_public_id
    FROM auth_sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.refresh_token_hash = ${refreshTokenHash}
      AND s.revoked_at IS NULL
    LIMIT 1
  `

  const session = rows?.[0]
  if (!session) return null

  await prisma.$executeRaw`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${session.id}
  `
  return session
}

async function getActiveSessionByHash(refreshTokenHash) {
  const rows = await prisma.$queryRaw`
    SELECT
      s.id,
      s.public_id,
      s.user_id,
      s.station_id,
      s.role_id,
      s.expires_at,
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      sr.code AS role_code
    FROM auth_sessions s
    INNER JOIN users u ON u.id = s.user_id
    LEFT JOIN stations st ON st.id = s.station_id
    LEFT JOIN staff_roles sr ON sr.id = s.role_id
    WHERE s.refresh_token_hash = ${refreshTokenHash}
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `

  return rows?.[0] || null
}

async function getActiveSessionByPublicId({ sessionPublicId, userId }) {
  if (!sessionPublicId || !userId) return null

  const rows = await prisma.$queryRaw`
    SELECT
      s.id,
      s.public_id,
      s.user_id,
      s.station_id,
      s.role_id,
      s.expires_at,
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      sr.code AS role_code
    FROM auth_sessions s
    INNER JOIN users u ON u.id = s.user_id
    LEFT JOIN stations st ON st.id = s.station_id
    LEFT JOIN staff_roles sr ON sr.id = s.role_id
    WHERE s.public_id = ${sessionPublicId}
      AND s.user_id = ${userId}
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `

  return rows?.[0] || null
}

export async function login({ credentials, req }) {
  const user = await getUserByCredentials(credentials)
  if (!user || !user.password_hash || !user.is_active) {
    throw badRequest("Invalid credentials")
  }

  const isValidPassword = await bcrypt.compare(credentials.password, user.password_hash)
  if (!isValidPassword) throw badRequest("Invalid credentials")
  return createLoginResultForUser({ user, req })
}

export async function beginPasskeyRegistration({ auth, req }) {
  const user = await getUserById(auth?.userId)
  if (!user?.id || !user?.is_active) {
    throw badRequest("Authenticated user profile not found")
  }

  const context = resolveWebAuthnContext(req)
  const challenge = randomBase64Url(32)
  const passkeys = await listUserPasskeys(user.id)
  const challengeRecord = await createPasskeyChallenge({
    userId: user.id,
    purpose: "REGISTER",
    challenge,
    origin: context.origin,
    rpId: context.rpId,
  })

  return {
    challengeId: challengeRecord.challengePublicId,
    expiresAt: challengeRecord.expiresAt,
    publicKey: {
      challenge,
      rp: {
        id: context.rpId,
        name: context.rpName,
      },
      user: {
        id: buildUserHandle(user.public_id),
        name: normalizeOptional(user.email) || normalizeOptional(user.phone_e164) || user.public_id,
        displayName: normalizeOptional(user.full_name) || "SmartLink User",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: passkeys.map((passkey) => ({
        type: "public-key",
        id: passkey.credentialId,
        transports: passkey.transports,
      })),
    },
  }
}

export async function listPasskeys({ auth }) {
  const user = await getUserById(auth?.userId)
  if (!user?.id || !user?.is_active) {
    throw badRequest("Authenticated user profile not found")
  }

  return {
    passkeys: await listUserPasskeys(user.id),
  }
}

export async function completePasskeyRegistration({ auth, payload, cookieChallenge = null, req }) {
  const user = await getUserById(auth?.userId)
  if (!user?.id || !user?.is_active) {
    throw badRequest("Authenticated user profile not found")
  }

  const clientDataChallenge = extractClientDataChallenge(payload?.credential?.response?.clientDataJSON)
  const challenge =
    (await getActivePasskeyChallenge({
      challengePublicId: payload?.challengeId,
      purpose: "REGISTER",
      userId: user.id,
    })) ||
    (clientDataChallenge
      ? await getActivePasskeyChallengeByChallengeValue({
          challenge: clientDataChallenge,
          purpose: "REGISTER",
          userId: user.id,
        })
      : null) ||
    (cookieChallenge &&
    String(cookieChallenge?.challenge || "").trim() === clientDataChallenge &&
    Number(cookieChallenge?.userId || 0) === Number(user.id)
      ? {
          id: 0,
          challenge: String(cookieChallenge.challenge || "").trim(),
          origin: String(cookieChallenge.origin || "").trim(),
          rp_id: String(cookieChallenge.rpId || "").trim(),
        }
      : null)
  if (!challenge?.challenge || !challenge?.origin || !challenge?.rp_id) {
    throw badRequest("Passkey registration challenge expired or was not found")
  }

  const verification = verifyPasskeyRegistration({
    credential: payload?.credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRpId: challenge.rp_id,
  })

  const existingPasskey = await getPasskeyByCredentialId(verification.credentialId)
  if (existingPasskey?.id) {
    throw badRequest("This passkey is already registered")
  }

  const label = normalizeOptional(payload?.name) || "Passkey"
  const passkeyPublicId = await createUserPasskey({
    userId: user.id,
    credentialId: verification.credentialId,
    publicKeyPem: verification.publicKeyPem,
    signCount: verification.counter,
    label,
    transports: verification.transports,
  })

  if (Number(challenge.id || 0) > 0) {
    await markPasskeyChallengeUsed(challenge.id)
  }
  await writeAuthAuditLogIfPossible({
    stationId: auth?.stationId || null,
    actionType: "AUTH_PASSKEY_REGISTERED",
    payload: {
      userPublicId: user.public_id,
      passkeyPublicId,
      ip: readClientMeta(req).ipAddress,
    },
  })

  return {
    created: true,
    passkey: {
      publicId: passkeyPublicId,
      label,
    },
  }
}

export async function beginPasskeyLogin({ req }) {
  const context = resolveWebAuthnContext(req)
  const challenge = randomBase64Url(32)
  const challengeRecord = await createPasskeyChallenge({
    purpose: "AUTHENTICATE",
    challenge,
    origin: context.origin,
    rpId: context.rpId,
  })

  return {
    challengeId: challengeRecord.challengePublicId,
    expiresAt: challengeRecord.expiresAt,
    publicKey: {
      challenge,
      rpId: context.rpId,
      timeout: 60000,
      userVerification: "required",
      allowCredentials: [],
    },
  }
}

export async function completePasskeyLogin({ payload, cookieChallenge = null, req }) {
  const clientDataChallenge = extractClientDataChallenge(payload?.credential?.response?.clientDataJSON)
  const challenge =
    (await getActivePasskeyChallenge({
      challengePublicId: payload?.challengeId,
      purpose: "AUTHENTICATE",
    })) ||
    (clientDataChallenge
      ? await getActivePasskeyChallengeByChallengeValue({
          challenge: clientDataChallenge,
          purpose: "AUTHENTICATE",
        })
      : null) ||
    (cookieChallenge && String(cookieChallenge?.challenge || "").trim() === clientDataChallenge
      ? {
          id: 0,
          challenge: String(cookieChallenge.challenge || "").trim(),
          origin: String(cookieChallenge.origin || "").trim(),
          rp_id: String(cookieChallenge.rpId || "").trim(),
        }
      : null)
  if (!challenge?.challenge || !challenge?.origin || !challenge?.rp_id) {
    throw badRequest("Passkey login challenge expired or was not found")
  }

  const credentialId = String(payload?.credential?.id || "").trim()
  const passkey = await getPasskeyByCredentialId(credentialId)
  if (!passkey?.id || !passkey?.is_active) {
    throw badRequest("Passkey not recognized")
  }

  const verification = verifyPasskeyAuthentication({
    credential: payload?.credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRpId: challenge.rp_id,
    publicKeyPem: passkey.public_key_pem,
    storedCounter: Number(passkey.sign_count || 0),
  })

  if (verification.userHandle && verification.userHandle !== passkey.user_public_id) {
    throw badRequest("Passkey user mismatch")
  }

  await touchUserPasskey({
    passkeyId: passkey.id,
    signCount: verification.nextCounter,
  })
  if (Number(challenge.id || 0) > 0) {
    await markPasskeyChallengeUsed(challenge.id)
  }

  return createLoginResultForUser({
    user: {
      id: Number(passkey.user_id),
      public_id: passkey.user_public_id,
      full_name: passkey.user_full_name,
      email: passkey.user_email,
      phone_e164: passkey.user_phone,
      password_hash: passkey.password_hash,
      is_active: passkey.is_active,
    },
    req,
  })
}

export async function removePasskey({ auth, passkeyPublicId, req }) {
  const user = await getUserById(auth?.userId)
  if (!user?.id || !user?.is_active) {
    throw badRequest("Authenticated user profile not found")
  }

  const passkey = await getUserPasskeyByPublicId({
    userId: user.id,
    passkeyPublicId,
  })
  if (!passkey?.id) {
    throw badRequest("Passkey not found")
  }

  await prisma.$executeRaw`
    DELETE FROM user_passkeys
    WHERE id = ${passkey.id}
    LIMIT 1
  `

  await writeAuthAuditLogIfPossible({
    stationId: auth?.stationId || null,
    actionType: "AUTH_PASSKEY_REMOVED",
    payload: {
      userPublicId: user.public_id,
      passkeyPublicId: passkey.public_id,
      ip: readClientMeta(req).ipAddress,
    },
  })

  return {
    removed: true,
    passkey: {
      publicId: passkey.public_id,
      label: normalizeOptional(passkey.label) || "Passkey",
    },
  }
}

export async function refresh({ refreshToken, req }) {
  if (!refreshToken) throw badRequest("Missing refresh token")
  const currentHash = hashToken(refreshToken)
  const current = await getActiveSessionByHash(currentHash)
  if (!current) throw badRequest("Invalid refresh session")

  try {
    await assertStationSubscriptionAccess({
      stationId: toNullableId(current.station_id),
      roleCode: current.role_code,
    })
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE auth_sessions
      SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${current.id}
    `
    throw error
  }

  await prisma.$executeRaw`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${current.id}
  `

  const nextRefreshToken = createRefreshToken()
  const nextHash = hashToken(nextRefreshToken)
  const nextSession = await createSession({
    userId: current.user_id,
    stationId: current.station_id,
    roleId: current.role_id,
    refreshTokenHash: nextHash,
    req,
  })

  await writeAuthAuditLogIfPossible({
    stationId: current.station_id,
    actionType: "AUTH_REFRESH",
    payload: {
      userPublicId: current.user_public_id,
      oldSessionPublicId: current.public_id,
      newSessionPublicId: nextSession.sessionPublicId,
      ip: nextSession.meta.ipAddress,
      userAgent: nextSession.meta.userAgent,
    },
  })

  const accessToken = signAccessToken({
    userPublicId: current.user_public_id,
    userId: Number(current.user_id),
    stationPublicId: normalizeOptional(current.station_public_id),
    stationId: toNullableId(current.station_id),
    role: normalizeOptional(current.role_code) || (toNullableId(current.station_id) ? "VIEWER" : "USER"),
    sessionPublicId: nextSession.sessionPublicId,
  })

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    refreshExpiresAt: nextSession.expiresAt,
  }
}

export async function logout({ refreshToken, req }) {
  if (!refreshToken) {
    return { revoked: false }
  }

  const hash = hashToken(refreshToken)
  const revoked = await revokeSessionByHash(hash)
  if (!revoked) {
    return { revoked: false }
  }

  const meta = readClientMeta(req)
  await writeAuthAuditLogIfPossible({
    stationId: revoked.station_id,
    actionType: "AUTH_LOGOUT",
    payload: {
      userPublicId: revoked.user_public_id,
      sessionPublicId: revoked.public_id,
      ip: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  return { revoked: true }
}

export async function me(auth) {
  const rows = await prisma.$queryRaw`
    SELECT
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      u.email AS user_email,
      u.phone_e164 AS user_phone,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.timezone AS station_timezone,
      sss.plan_code,
      sss.plan_name,
      sss.monthly_fee_mwk,
      sss.status AS subscription_status,
      sss.renewal_date AS subscription_renewal_date
    FROM users u
    LEFT JOIN stations st ON st.id <=> ${auth.stationId}
    LEFT JOIN station_subscription_statuses sss ON sss.station_id = st.id
    WHERE u.id = ${auth.userId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row) throw badRequest("Authenticated user profile not found")

  const memberships = await listActiveStationStaffMemberships(auth.userId)

  return {
    user: {
      publicId: row.user_public_id,
      fullName: row.user_full_name,
      email: row.user_email,
      phone: row.user_phone,
    },
    station: row.station_public_id
      ? {
          publicId: row.station_public_id,
          name: row.station_name,
          timezone: normalizeOptional(row.station_timezone) || "Africa/Blantyre",
          subscription: toStationSubscriptionSummary({
            plan_code: row.plan_code,
            plan_name: row.plan_name,
            monthly_fee_mwk: row.monthly_fee_mwk,
            status: row.subscription_status,
            renewal_date: row.subscription_renewal_date,
          }),
        }
      : null,
    role: auth.role,
    stationMemberships: mapStationMemberships(memberships, row.station_public_id || null),
  }
}

export async function updateProfile({ auth, payload, req }) {
  if (!auth?.userId) throw badRequest("Missing authenticated user")

  const rows = await prisma.$queryRaw`
    SELECT public_id, full_name, email, phone_e164
    FROM users
    WHERE id = ${auth.userId}
    LIMIT 1
  `
  const user = rows?.[0] || null
  if (!user?.public_id) throw badRequest("Authenticated user profile not found")

  const currentFullName = normalizeOptional(user.full_name)
  const currentEmail = normalizeOptional(user.email)?.toLowerCase() || null
  const currentPhone = normalizeOptional(user.phone_e164)

  const nextFullName =
    payload?.fullName === undefined ? currentFullName : normalizeOptional(payload.fullName)
  const nextEmail =
    payload?.email === undefined
      ? currentEmail
      : normalizeOptional(payload.email)?.toLowerCase() || null
  const nextPhone =
    payload?.phone === undefined ? currentPhone : normalizeOptional(payload.phone)

  if (!nextFullName) throw badRequest("Full name is required")
  if (!nextEmail && !nextPhone) throw badRequest("Email or phone is required")

  const changedFields = []
  if (nextFullName !== currentFullName) changedFields.push("fullName")
  if (nextEmail !== currentEmail) changedFields.push("email")
  if (nextPhone !== currentPhone) changedFields.push("phone")
  if (!changedFields.length) throw badRequest("No profile changes provided")

  const conflictRows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE id <> ${auth.userId}
      AND (
        (${nextEmail} IS NOT NULL AND email = ${nextEmail})
        OR (${nextPhone} IS NOT NULL AND phone_e164 = ${nextPhone})
      )
    LIMIT 1
  `
  if (conflictRows?.[0]?.id) {
    throw badRequest("Another account already uses that email or phone")
  }

  await prisma.$executeRaw`
    UPDATE users
    SET
      full_name = ${nextFullName},
      email = ${nextEmail},
      phone_e164 = ${nextPhone}
    WHERE id = ${auth.userId}
  `

  const meta = readClientMeta(req)
  await writeAuthAuditLogIfPossible({
    stationId: auth.stationId || null,
    actionType: "AUTH_PROFILE_UPDATED",
    payload: {
      userPublicId: user.public_id,
      changedFields,
      ip: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  return me(auth)
}

export async function switchStation({ auth, stationPublicId, refreshToken, req }) {
  if (!auth?.userId) throw badRequest("Missing authenticated user")

  const membershipAccess = await listStationStaffMembershipsWithAccess(auth.userId)
  const nextAssignedMembership = membershipAccess.find((membership) => membership.stationPublicId === stationPublicId)
  if (!nextAssignedMembership?.stationId) {
    throw badRequest("Selected station is not assigned to this account")
  }
  if (!nextAssignedMembership.subscriptionAccess.allowed) {
    throw unauthorized(
      nextAssignedMembership.subscriptionAccess.message ||
        "The station subscription has expired. Renew it before signing in again."
    )
  }

  const memberships = membershipAccess.filter((membership) => membership.subscriptionAccess.allowed)
  const nextMembership = memberships.find((membership) => membership.stationPublicId === stationPublicId)

  const currentHash = refreshToken ? hashToken(refreshToken) : null
  const currentSession =
    (auth.sessionPublicId
      ? await getActiveSessionByPublicId({
          sessionPublicId: auth.sessionPublicId,
          userId: auth.userId,
        })
      : null) || (currentHash ? await getActiveSessionByHash(currentHash) : null)

  if (!currentSession) throw badRequest("Active session not found")

  await prisma.$executeRaw`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${currentSession.id}
  `

  const nextRefreshToken = createRefreshToken()
  const nextHash = hashToken(nextRefreshToken)
  const nextSession = await createSession({
    userId: auth.userId,
    stationId: nextMembership.stationId,
    roleId: nextMembership.roleId,
    refreshTokenHash: nextHash,
    req,
  })

  await writeAuthAuditLogIfPossible({
    stationId: nextMembership.stationId,
    actionType: "AUTH_SWITCH_STATION",
    payload: {
      userPublicId: auth.userPublicId || null,
      oldSessionPublicId: currentSession.public_id,
      newSessionPublicId: nextSession.sessionPublicId,
      stationPublicId: nextMembership.stationPublicId,
      role: nextMembership.roleCode,
      ip: nextSession.meta.ipAddress,
      userAgent: nextSession.meta.userAgent,
    },
  })

  const accessToken = signAccessToken({
    userPublicId: auth.userPublicId,
    userId: Number(auth.userId),
    stationPublicId: nextMembership.stationPublicId,
    stationId: nextMembership.stationId,
    role: nextMembership.roleCode,
    sessionPublicId: nextSession.sessionPublicId,
  })

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    refreshExpiresAt: nextSession.expiresAt,
    station: {
      publicId: nextMembership.stationPublicId,
      name: nextMembership.stationName || "Station",
      timezone: nextMembership.stationTimeZone || "Africa/Blantyre",
      subscription: nextMembership.subscription || null,
    },
    role: nextMembership.roleCode,
    stationMemberships: mapStationMemberships(memberships, nextMembership.stationPublicId),
  }
}

async function getSessionByHashForUser(userId, refreshTokenHash) {
  if (!refreshTokenHash) return null
  const rows = await prisma.$queryRaw`
    SELECT id, public_id
    FROM auth_sessions
    WHERE user_id = ${userId}
      AND refresh_token_hash = ${refreshTokenHash}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function listSessions({ auth, refreshToken }) {
  if (!auth?.userId) throw badRequest("Missing authenticated user")
  const currentHash = refreshToken ? hashToken(refreshToken) : null
  const timeZone = await resolveStationTimeZone(auth.stationId)
  const rows = await prisma.$queryRaw`
    SELECT
      public_id,
      refresh_token_hash,
      user_agent,
      ip_address,
      created_at,
      updated_at,
      expires_at
    FROM auth_sessions
    WHERE user_id = ${auth.userId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    ORDER BY updated_at DESC, created_at DESC
  `

  const mapped = (rows || []).map((row) => ({
    sessionPublicId: row.public_id,
    userAgent: row.user_agent || "Unknown device",
    ipAddress: row.ip_address || "Unknown IP",
    createdAt: serializeDateForTimeZone(row.created_at, timeZone),
    lastActiveAt: serializeDateForTimeZone(row.updated_at, timeZone),
    expiresAt: serializeDateForTimeZone(row.expires_at, timeZone),
    isCurrent: currentHash ? row.refresh_token_hash === currentHash : false,
  }))

  const currentSession = mapped.find((row) => row.isCurrent) || null
  const otherSessions = mapped.filter((row) => !row.isCurrent)
  return {
    currentSession,
    otherSessions,
  }
}

export async function logoutOthers({ auth, refreshToken, req }) {
  if (!auth?.userId) throw badRequest("Missing authenticated user")
  const currentHash = refreshToken ? hashToken(refreshToken) : null
  const currentSession = await getSessionByHashForUser(auth.userId, currentHash)

  let revokedCount = 0
  if (currentSession?.id) {
    revokedCount = await prisma.$executeRaw`
      UPDATE auth_sessions
      SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ${auth.userId}
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
        AND id <> ${currentSession.id}
    `
  } else {
    revokedCount = await prisma.$executeRaw`
      UPDATE auth_sessions
      SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ${auth.userId}
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
    `
  }

  const meta = readClientMeta(req)
  await writeAuthAuditLogIfPossible({
    stationId: auth.stationId,
    actionType: "AUTH_LOGOUT_OTHERS",
    payload: {
      userPublicId: auth.userPublicId || null,
      revokedCount: Number(revokedCount || 0),
      retainedCurrent: Boolean(currentSession?.id),
      ip: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  return {
    loggedOutOthers: true,
    revokedCount: Number(revokedCount || 0),
  }
}

export async function changePassword({ auth, payload, refreshToken, req }) {
  if (!auth?.userId) throw badRequest("Missing authenticated user")
  const rows = await prisma.$queryRaw`
    SELECT id, password_hash, is_active
    FROM users
    WHERE id = ${auth.userId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user || !user.is_active) throw badRequest("Authenticated user not active")
  if (!user.password_hash) throw badRequest("Password login is not configured for this user")

  const passwordValid = await bcrypt.compare(payload.currentPassword, user.password_hash)
  if (!passwordValid) throw badRequest("Current password is incorrect")
  if (payload.currentPassword === payload.newPassword) {
    throw badRequest("New password must be different from current password")
  }

  const nextHash = await bcrypt.hash(payload.newPassword, 10)
  await prisma.$executeRaw`
    UPDATE users
    SET password_hash = ${nextHash}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${auth.userId}
  `

  const currentHash = refreshToken ? hashToken(refreshToken) : null
  const currentSession = await getSessionByHashForUser(auth.userId, currentHash)
  let revokedCount = 0
  if (currentSession?.id) {
    revokedCount = await prisma.$executeRaw`
      UPDATE auth_sessions
      SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ${auth.userId}
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
        AND id <> ${currentSession.id}
    `
  } else {
    revokedCount = await prisma.$executeRaw`
      UPDATE auth_sessions
      SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ${auth.userId}
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
    `
  }

  const meta = readClientMeta(req)
  await writeAuthAuditLogIfPossible({
    stationId: auth.stationId,
    actionType: "AUTH_PASSWORD_CHANGE",
    payload: {
      userPublicId: auth.userPublicId || null,
      revokedCount: Number(revokedCount || 0),
      retainedCurrent: Boolean(currentSession?.id),
      ip: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  return {
    changed: true,
    revokedSessions: Number(revokedCount || 0),
  }
}

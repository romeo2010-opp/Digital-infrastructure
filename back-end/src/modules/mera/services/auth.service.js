import bcrypt from "bcryptjs"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { prisma } from "../../../db/prisma.js"
import { badRequest } from "../../../utils/http.js"
import { createPublicId } from "../../common/db.js"
import { normalizePermissionList } from "../permissions.js"
import { logMeraAudit } from "./audit.service.js"

const MERA_ACCESS_TOKEN_TTL_MIN = Number(process.env.MERA_ACCESS_TOKEN_TTL_MIN || 480)

function getMeraJwtSecret() {
  return process.env.JWT_MERA_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET || ""
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function normalizeAccessRows(rows = []) {
  const firstRow = rows?.[0]
  if (!firstRow?.id) return null

  return {
    id: Number(firstRow.id),
    publicId: String(firstRow.public_id || "").trim(),
    fullName: String(firstRow.full_name || "").trim(),
    email: String(firstRow.email || "").trim(),
    phone: String(firstRow.phone || "").trim() || null,
    password_hash: String(firstRow.password_hash || "").trim() || null,
    districtScope: String(firstRow.district_scope || "").trim() || null,
    regionScope: String(firstRow.region_scope || "").trim() || null,
    accountStatus: String(firstRow.account_status || "").trim(),
    lastLoginAt: firstRow.last_login_at || null,
    role: {
      id: Number(firstRow.role_id || 0),
      code: String(firstRow.role_code || "").trim().toUpperCase(),
      displayName: String(firstRow.role_display_name || "").trim() || null,
      description: String(firstRow.role_description || "").trim() || null,
    },
    permissions: normalizePermissionList(rows.map((row) => row.permission_code).filter(Boolean)),
  }
}

export async function getMeraUserAccessById(meraUserId) {
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.password_hash,
      mu.district_scope,
      mu.region_scope,
      mu.account_status,
      mu.last_login_at,
      mr.id AS role_id,
      mr.code AS role_code,
      mr.display_name AS role_display_name,
      mr.description AS role_description,
      mp.code AS permission_code
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    LEFT JOIN mera_role_permissions mrp ON mrp.role_id = mr.id
    LEFT JOIN mera_permissions mp ON mp.id = mrp.permission_id
    WHERE mu.id = ${meraUserId}
  `
  return normalizeAccessRows(rows)
}

async function getMeraUserAccessByEmail(email) {
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.password_hash,
      mu.district_scope,
      mu.region_scope,
      mu.account_status,
      mu.last_login_at,
      mr.id AS role_id,
      mr.code AS role_code,
      mr.display_name AS role_display_name,
      mr.description AS role_description,
      mp.code AS permission_code
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    LEFT JOIN mera_role_permissions mrp ON mrp.role_id = mr.id
    LEFT JOIN mera_permissions mp ON mp.id = mrp.permission_id
    WHERE mu.email = ${email}
  `
  return normalizeAccessRows(rows)
}

function signMeraAccessToken(identity) {
  const secret = getMeraJwtSecret()
  if (!secret) throw badRequest("MERA JWT secret is not configured")

  return jwt.sign(
    {
      scope: "mera",
      sub: identity.userPublicId,
      uid: identity.userId,
      sid: identity.sessionPublicId,
      role: identity.roleCode,
      district: identity.districtScope,
      region: identity.regionScope,
    },
    secret,
    {
      expiresIn: `${MERA_ACCESS_TOKEN_TTL_MIN}m`,
    }
  )
}

async function createMeraSession({ meraUserId, req }) {
  const sessionPublicId = createPublicId()
  const sessionToken = crypto.randomBytes(40).toString("base64url")
  const sessionHash = hashToken(sessionToken)
  const userAgent = req.header("user-agent")?.slice(0, 255) || null
  const ipAddress = (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null

  await prisma.$executeRaw`
    INSERT INTO mera_auth_sessions (
      public_id,
      mera_user_id,
      session_token_hash,
      user_agent,
      ip_address,
      expires_at
    )
    VALUES (
      ${sessionPublicId},
      ${meraUserId},
      ${sessionHash},
      ${userAgent},
      ${ipAddress},
      DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${MERA_ACCESS_TOKEN_TTL_MIN} MINUTE)
    )
  `

  return { sessionPublicId, sessionToken }
}

export async function getActiveMeraSession(sessionPublicId, meraUserId) {
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM mera_auth_sessions
    WHERE public_id = ${sessionPublicId}
      AND mera_user_id = ${meraUserId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function buildMeraAuthPayload(accessRow, req) {
  const scopedRole = String(accessRow?.role?.code || "").trim().toUpperCase()
  if (!accessRow?.id || !scopedRole) throw badRequest("MERA account is not configured correctly")
  if (String(accessRow.accountStatus || "").toUpperCase() !== "ACTIVE") {
    throw badRequest("MERA account is not active")
  }

  const { sessionPublicId } = await createMeraSession({
    meraUserId: Number(accessRow.id),
    req,
  })

  await prisma.$executeRaw`
    UPDATE mera_users
    SET last_login_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${accessRow.id}
  `

  const accessToken = signMeraAccessToken({
    userPublicId: String(accessRow.publicId || "").trim(),
    userId: Number(accessRow.id),
    sessionPublicId,
    roleCode: scopedRole,
    districtScope: accessRow.districtScope,
    regionScope: accessRow.regionScope,
  })

  return {
    accessToken,
    sessionPublicId,
    user: {
      publicId: accessRow.publicId,
      fullName: accessRow.fullName,
      email: accessRow.email,
      phone: accessRow.phone,
      districtScope: accessRow.districtScope,
      regionScope: accessRow.regionScope,
      role: scopedRole,
      roleDisplayName: accessRow.role.displayName,
      roleDescription: accessRow.role.description,
      permissions: accessRow.permissions,
      accountStatus: accessRow.accountStatus,
      lastLoginAt: new Date().toISOString(),
    },
  }
}

export async function login({ payload, req }) {
  const email = String(payload?.email || "").trim().toLowerCase()
  const password = String(payload?.password || "")
  if (!email || !password) throw badRequest("Email and password are required")

  const user = await getMeraUserAccessByEmail(email)
  if (!user?.id || !user.password_hash) throw badRequest("Invalid MERA credentials")

  const matches = await bcrypt.compare(password, String(user.password_hash || ""))
  if (!matches) throw badRequest("Invalid MERA credentials")

  return buildMeraAuthPayload(user, req)
}

export async function me(auth) {
  const session = await getActiveMeraSession(auth?.sessionPublicId, auth?.userId)
  if (!session?.public_id) throw badRequest("MERA session expired")
  const user = await getMeraUserAccessById(auth.userId)
  if (!user?.id) throw badRequest("MERA user was not found")

  return {
    sessionPublicId: session.public_id,
    user: {
      publicId: user.publicId,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      districtScope: user.districtScope,
      regionScope: user.regionScope,
      role: user.role.code,
      roleDisplayName: user.role.displayName,
      roleDescription: user.role.description,
      permissions: user.permissions,
      accountStatus: user.accountStatus,
      lastLoginAt: user.lastLoginAt,
    },
  }
}

async function getMeraUserById(meraUserId) {
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district_scope,
      mu.region_scope,
      mu.password_hash,
      mu.account_status,
      mr.code AS role_code,
      mr.display_name AS role_display_name,
      mr.description AS role_description
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.id = ${meraUserId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function ensureMeraPreferences(meraUserId) {
  const existingRows = await prisma.$queryRaw`
    SELECT
      mera_user_id,
      appearance,
      density,
      landing_page,
      compact_tables,
      shortage_alerts,
      complaints_alerts,
      daily_digest,
      browser_notifications,
      session_timeout_minutes,
      require_step_up,
      trusted_device,
      updated_at
    FROM mera_user_preferences
    WHERE mera_user_id = ${meraUserId}
    LIMIT 1
  `
  if (existingRows?.[0]) return existingRows[0]

  await prisma.$executeRaw`
    INSERT INTO mera_user_preferences (
      mera_user_id,
      appearance,
      density,
      landing_page,
      compact_tables,
      shortage_alerts,
      complaints_alerts,
      daily_digest,
      browser_notifications,
      session_timeout_minutes,
      require_step_up,
      trusted_device
    )
    VALUES (
      ${meraUserId},
      'system',
      'comfortable',
      'dashboard',
      0,
      1,
      1,
      1,
      0,
      30,
      1,
      0
    )
  `

  const createdRows = await prisma.$queryRaw`
    SELECT
      mera_user_id,
      appearance,
      density,
      landing_page,
      compact_tables,
      shortage_alerts,
      complaints_alerts,
      daily_digest,
      browser_notifications,
      session_timeout_minutes,
      require_step_up,
      trusted_device,
      updated_at
    FROM mera_user_preferences
    WHERE mera_user_id = ${meraUserId}
    LIMIT 1
  `
  return createdRows?.[0] || null
}

function toMeraPreferencesResponse(row) {
  if (!row) return null
  return {
    appearance: String(row.appearance || 'system'),
    density: String(row.density || 'comfortable'),
    landingPage: String(row.landing_page || 'dashboard'),
    compactTables: Boolean(row.compact_tables),
    shortageAlerts: Boolean(row.shortage_alerts),
    complaintsAlerts: Boolean(row.complaints_alerts),
    dailyDigest: Boolean(row.daily_digest),
    browserNotifications: Boolean(row.browser_notifications),
    sessionTimeout: String(row.session_timeout_minutes || 30),
    requireStepUp: Boolean(row.require_step_up),
    trustedDevice: Boolean(row.trusted_device),
    updatedAt: row.updated_at || null,
  }
}

export async function patchMe(auth, payload) {
  if (!auth?.userId) throw badRequest("Missing MERA user")
  const current = await getMeraUserById(auth.userId)
  if (!current?.id) throw badRequest("MERA user was not found")

  const nextFullName = payload.fullName !== undefined ? String(payload.fullName || "").trim() : undefined
  const nextEmail = payload.email !== undefined ? String(payload.email || "").trim().toLowerCase() : undefined
  const nextPhone = payload.phone !== undefined ? String(payload.phone || "").trim() || null : undefined

  if (nextEmail && nextEmail !== String(current.email || "").trim().toLowerCase()) {
    const duplicateRows = await prisma.$queryRaw`
      SELECT id
      FROM mera_users
      WHERE email = ${nextEmail}
        AND id <> ${auth.userId}
      LIMIT 1
    `
    if (duplicateRows?.[0]?.id) throw badRequest("That email address is already in use")
  }

  const fields = []
  const values = []
  if (nextFullName !== undefined) {
    fields.push("full_name = ?")
    values.push(nextFullName)
  }
  if (nextEmail !== undefined) {
    fields.push("email = ?")
    values.push(nextEmail)
  }
  if (nextPhone !== undefined) {
    fields.push("phone = ?")
    values.push(nextPhone)
  }

  if (fields.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE mera_users SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      ...values,
      auth.userId
    )
    await prisma.$executeRaw`
      UPDATE mera_auth_sessions
      SET last_seen_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${auth.sessionPublicId}
    `
    await logMeraAudit({
      actorId: auth.userId,
      actorRole: auth.role,
      actionType: "MERA_PROFILE_UPDATED",
      actionDescription: "MERA user profile details were updated.",
    })
  }

  return me(auth)
}

export async function changePassword(auth, payload) {
  if (!auth?.userId) throw badRequest("Missing MERA user")
  const user = await getMeraUserById(auth.userId)
  if (!user?.id || !user.password_hash) throw badRequest("Password login is not configured for this MERA user")

  const passwordValid = await bcrypt.compare(payload.currentPassword, String(user.password_hash || ""))
  if (!passwordValid) throw badRequest("Current password is incorrect")
  if (payload.currentPassword === payload.newPassword) {
    throw badRequest("New password must be different from current password")
  }

  const nextHash = await bcrypt.hash(payload.newPassword, 10)
  await prisma.$executeRaw`
    UPDATE mera_users
    SET password_hash = ${nextHash}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${auth.userId}
  `

  await prisma.$executeRaw`
    UPDATE mera_auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3)
    WHERE mera_user_id = ${auth.userId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
      AND public_id <> ${auth.sessionPublicId}
  `

  await logMeraAudit({
    actorId: auth.userId,
    actorRole: auth.role,
    actionType: "MERA_PASSWORD_CHANGED",
    actionDescription: "MERA user changed their password and other sessions were revoked.",
  })

  return {
    passwordChanged: true,
  }
}

export async function getMyPreferences(auth) {
  if (!auth?.userId) throw badRequest("Missing MERA user")
  const row = await ensureMeraPreferences(auth.userId)
  return toMeraPreferencesResponse(row)
}

export async function patchMyPreferences(auth, payload) {
  if (!auth?.userId) throw badRequest("Missing MERA user")
  const current = await ensureMeraPreferences(auth.userId)
  if (!current) throw badRequest("MERA preferences could not be loaded")

  const patch = {}
  if (payload.appearance !== undefined) patch.appearance = payload.appearance
  if (payload.density !== undefined) patch.density = payload.density
  if (payload.landingPage !== undefined) patch.landing_page = payload.landingPage
  if (payload.compactTables !== undefined) patch.compact_tables = payload.compactTables
  if (payload.shortageAlerts !== undefined) patch.shortage_alerts = payload.shortageAlerts
  if (payload.complaintsAlerts !== undefined) patch.complaints_alerts = payload.complaintsAlerts
  if (payload.dailyDigest !== undefined) patch.daily_digest = payload.dailyDigest
  if (payload.browserNotifications !== undefined) patch.browser_notifications = payload.browserNotifications
  if (payload.sessionTimeout !== undefined) patch.session_timeout_minutes = Number(payload.sessionTimeout)
  if (payload.requireStepUp !== undefined) patch.require_step_up = payload.requireStepUp
  if (payload.trustedDevice !== undefined) patch.trusted_device = payload.trustedDevice

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  if (fields.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE mera_user_preferences SET ${fields.join(", ")} WHERE mera_user_id = ?`,
      ...values,
      auth.userId
    )
    await logMeraAudit({
      actorId: auth.userId,
      actorRole: auth.role,
      actionType: "MERA_PREFERENCES_UPDATED",
      actionDescription: "MERA user updated portal preferences.",
    })
  }

  const rows = await prisma.$queryRaw`
    SELECT
      mera_user_id,
      appearance,
      density,
      landing_page,
      compact_tables,
      shortage_alerts,
      complaints_alerts,
      daily_digest,
      browser_notifications,
      session_timeout_minutes,
      require_step_up,
      trusted_device,
      updated_at
    FROM mera_user_preferences
    WHERE mera_user_id = ${auth.userId}
    LIMIT 1
  `
  return toMeraPreferencesResponse(rows?.[0] || null)
}

export async function logout(auth) {
  if (!auth?.sessionPublicId) return
  await prisma.$executeRaw`
    UPDATE mera_auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${auth.sessionPublicId}
  `
}

export function verifyAnyRole(auth, requestedRoles = []) {
  const currentRole = String(auth?.role || "").trim().toUpperCase()
  return requestedRoles.includes(currentRole)
}

export function getMeraJwtSecretForMiddleware() {
  return getMeraJwtSecret()
}

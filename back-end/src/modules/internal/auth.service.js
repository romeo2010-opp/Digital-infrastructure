import bcrypt from "bcryptjs"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { prisma } from "../../db/prisma.js"
import { badRequest } from "../../utils/http.js"
import { createPublicId } from "../common/db.js"
import { INTERNAL_ROLE_NAV, normalizePermissionList, resolveEffectiveInternalPermissions } from "./permissions.js"

const INTERNAL_ACCESS_TOKEN_TTL_MIN = Number(process.env.INTERNAL_ACCESS_TOKEN_TTL_MIN || 480)

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function signInternalAccessToken(identity) {
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) throw badRequest("JWT access secret is not configured")

  return jwt.sign(
    {
      scope: "internal",
      sub: identity.userPublicId,
      uid: identity.userId,
      sid: identity.sessionPublicId,
      roles: identity.roles,
      primaryRole: identity.primaryRole,
    },
    secret,
    {
      expiresIn: `${INTERNAL_ACCESS_TOKEN_TTL_MIN}m`,
    }
  )
}

async function getInternalIdentityByEmail(email) {
  const rows = await prisma.$queryRaw`
    SELECT
      u.id,
      u.public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      u.password_hash,
      u.is_active
    FROM users u
    WHERE u.email = ${email}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function listInternalRoleRows(userId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ir.code AS role_code,
      ir.name AS role_name,
      ir.department,
      ir.rank_order
    FROM internal_user_roles iur
    INNER JOIN internal_roles ir ON ir.id = iur.role_id
    WHERE iur.user_id = ${userId}
      AND iur.is_active = 1
      AND ir.is_active = 1
    ORDER BY ir.rank_order ASC, ir.id ASC
  `
  return rows || []
}

async function listInternalPermissionRows(userId) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ip.code
    FROM internal_user_roles iur
    INNER JOIN internal_roles ir ON ir.id = iur.role_id
    INNER JOIN internal_role_permissions irp ON irp.role_id = ir.id
    INNER JOIN internal_permissions ip ON ip.id = irp.permission_id
    WHERE iur.user_id = ${userId}
      AND iur.is_active = 1
      AND ir.is_active = 1
    ORDER BY ip.code ASC
  `
  return normalizePermissionList((rows || []).map((row) => row.code))
}

function buildInternalNavigation(permissions = []) {
  const navigation = Object.entries(INTERNAL_ROLE_NAV)
    .filter(([, permission]) => permissions.includes(permission))
    .map(([key]) => key)

  if (!navigation.includes("settings")) navigation.push("settings")
  return navigation
}

async function createInternalSession({ userId, req }) {
  const sessionPublicId = createPublicId()
  const sessionToken = crypto.randomBytes(40).toString("base64url")
  const sessionHash = hashToken(sessionToken)
  const userAgent = req.header("user-agent")?.slice(0, 255) || null
  const ipAddress = (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null

  await prisma.$executeRaw`
    INSERT INTO internal_auth_sessions (
      public_id,
      user_id,
      session_token_hash,
      user_agent,
      ip_address,
      expires_at
    )
    VALUES (
      ${sessionPublicId},
      ${userId},
      ${sessionHash},
      ${userAgent},
      ${ipAddress},
      DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${INTERNAL_ACCESS_TOKEN_TTL_MIN} MINUTE)
    )
  `

  return {
    sessionPublicId,
    sessionToken,
  }
}

async function getInternalSessionByPublicId(sessionPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT public_id, user_id
    FROM internal_auth_sessions
    WHERE public_id = ${sessionPublicId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  return rows?.[0] || null
}

async function buildInternalAuthPayload(userRow, req) {
  const roles = await listInternalRoleRows(userRow.id)
  if (!roles.length) throw badRequest("This account is not assigned to any internal role.")
  const permissions = resolveEffectiveInternalPermissions(
    roles.map((row) => row.role_code),
    await listInternalPermissionRows(userRow.id)
  )
  const primaryRole = String(roles[0]?.role_code || "").trim()

  const { sessionPublicId } = await createInternalSession({ userId: userRow.id, req })
  const accessToken = signInternalAccessToken({
    userPublicId: userRow.public_id,
    userId: Number(userRow.id),
    sessionPublicId,
    roles: roles.map((row) => row.role_code),
    primaryRole,
  })

  return {
    accessToken,
    user: {
      publicId: String(userRow.public_id || "").trim(),
      fullName: String(userRow.full_name || "").trim() || "SmartLink Staff",
      email: String(userRow.email || "").trim() || null,
      phone: String(userRow.phone_e164 || "").trim() || null,
    },
    primaryRole,
    roles: roles.map((row) => ({
      code: row.role_code,
      name: row.role_name,
      department: row.department,
    })),
    permissions,
    navigation: buildInternalNavigation(permissions),
    sessionPublicId,
  }
}

export async function login({ payload, req }) {
  const email = String(payload?.email || "").trim().toLowerCase()
  const password = String(payload?.password || "")
  if (!email || !password) throw badRequest("Email and password are required")

  const user = await getInternalIdentityByEmail(email)
  if (!user?.id || !Number(user.is_active) || !user.password_hash) {
    throw badRequest("Invalid credentials")
  }

  const matches = await bcrypt.compare(password, String(user.password_hash || ""))
  if (!matches) throw badRequest("Invalid credentials")

  return buildInternalAuthPayload(user, req)
}

export async function me(auth) {
  const session = await getInternalSessionByPublicId(auth?.sessionPublicId)
  if (!session?.public_id) throw badRequest("Internal session expired")

  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, email, phone_e164, is_active
    FROM users
    WHERE id = ${auth.userId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id || !Number(user.is_active)) throw badRequest("Internal user is inactive")

  const roles = await listInternalRoleRows(user.id)
  const permissions = resolveEffectiveInternalPermissions(
    roles.map((row) => row.role_code),
    await listInternalPermissionRows(user.id)
  )
  const primaryRole = String(roles[0]?.role_code || "").trim()

  return {
    user: {
      publicId: String(user.public_id || "").trim(),
      fullName: String(user.full_name || "").trim() || "SmartLink Staff",
      email: String(user.email || "").trim() || null,
      phone: String(user.phone_e164 || "").trim() || null,
    },
    primaryRole,
    roles: roles.map((row) => ({
      code: row.role_code,
      name: row.role_name,
      department: row.department,
    })),
    permissions,
    navigation: buildInternalNavigation(permissions),
    sessionPublicId: auth.sessionPublicId,
  }
}

export async function updateMe(auth, payload) {
  if (!auth?.userId) throw badRequest("Missing internal user")

  const nextFullName = payload?.fullName === undefined ? undefined : String(payload.fullName || "").trim()
  const nextPhone = payload?.phone === undefined ? undefined : String(payload.phone || "").trim()

  if (nextFullName !== undefined && !nextFullName) {
    throw badRequest("Full name is required")
  }

  const updates = []
  if (nextFullName !== undefined) updates.push(prisma.$executeRaw`UPDATE users SET full_name = ${nextFullName} WHERE id = ${auth.userId}`)
  if (payload?.phone !== undefined) {
    updates.push(
      prisma.$executeRaw`UPDATE users SET phone_e164 = ${nextPhone || null} WHERE id = ${auth.userId}`
    )
  }

  if (!updates.length) throw badRequest("No profile changes provided")

  await Promise.all(updates)
  return me(auth)
}

export async function logout(auth) {
  if (!auth?.sessionPublicId) return
  await prisma.$executeRaw`
    UPDATE internal_auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${auth.sessionPublicId}
  `
}

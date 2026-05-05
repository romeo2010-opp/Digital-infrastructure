import bcrypt from "bcryptjs"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { prisma } from "../../../db/prisma.js"
import { badRequest } from "../../../utils/http.js"
import { createPublicId } from "../../common/db.js"

const MERA_ACCESS_TOKEN_TTL_MIN = Number(process.env.MERA_ACCESS_TOKEN_TTL_MIN || 480)

function getMeraJwtSecret() {
  return process.env.JWT_MERA_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET || ""
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
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
      role: identity.roleName,
      district: identity.district,
    },
    secret,
    {
      expiresIn: `${MERA_ACCESS_TOKEN_TTL_MIN}m`,
    }
  )
}

export async function getMeraUserByEmail(email) {
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.password_hash,
      mu.district,
      mu.account_status,
      mr.role_name,
      mr.role_description
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.email = ${email}
    LIMIT 1
  `
  return rows?.[0] || null
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

export async function buildMeraAuthPayload(userRow, req) {
  const scopedRole = String(userRow?.role_name || "").trim().toUpperCase()
  if (!userRow?.id || !scopedRole) throw badRequest("MERA account is not configured correctly")
  if (String(userRow.account_status || "").toUpperCase() !== "ACTIVE") {
    throw badRequest("MERA account is not active")
  }

  const { sessionPublicId } = await createMeraSession({
    meraUserId: Number(userRow.id),
    req,
  })

  const accessToken = signMeraAccessToken({
    userPublicId: String(userRow.public_id || "").trim(),
    userId: Number(userRow.id),
    sessionPublicId,
    roleName: scopedRole,
    district: String(userRow.district || "").trim() || null,
  })

  return {
    accessToken,
    sessionPublicId,
    user: {
      publicId: String(userRow.public_id || "").trim(),
      fullName: String(userRow.full_name || "").trim(),
      email: String(userRow.email || "").trim(),
      phone: String(userRow.phone || "").trim() || null,
      district: String(userRow.district || "").trim() || null,
      role: scopedRole,
      roleDescription: String(userRow.role_description || "").trim() || null,
      accountStatus: String(userRow.account_status || "").trim(),
    },
  }
}

export async function login({ payload, req }) {
  const email = String(payload?.email || "").trim().toLowerCase()
  const password = String(payload?.password || "")
  if (!email || !password) throw badRequest("Email and password are required")

  const user = await getMeraUserByEmail(email)
  if (!user?.id || !user.password_hash) throw badRequest("Invalid MERA credentials")

  const matches = await bcrypt.compare(password, String(user.password_hash || ""))
  if (!matches) throw badRequest("Invalid MERA credentials")

  return buildMeraAuthPayload(user, req)
}

export async function me(auth) {
  const session = await getActiveMeraSession(auth?.sessionPublicId, auth?.userId)
  if (!session?.public_id) throw badRequest("MERA session expired")

  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district,
      mu.account_status,
      mr.role_name,
      mr.role_description
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.id = ${auth.userId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id) throw badRequest("MERA user was not found")

  return {
    sessionPublicId: session.public_id,
    user: {
      publicId: String(user.public_id || "").trim(),
      fullName: String(user.full_name || "").trim(),
      email: String(user.email || "").trim(),
      phone: String(user.phone || "").trim() || null,
      district: String(user.district || "").trim() || null,
      role: String(user.role_name || "").trim(),
      roleDescription: String(user.role_description || "").trim() || null,
      accountStatus: String(user.account_status || "").trim(),
    },
  }
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

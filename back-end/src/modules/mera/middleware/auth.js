import jwt from "jsonwebtoken"
import { prisma } from "../../../db/prisma.js"
import { hasMeraPermission, normalizeRoleList } from "../permissions.js"
import { getMeraJwtSecretForMiddleware, getMeraUserAccessById } from "../services/auth.service.js"

function unauthorized(res, message = "Unauthorized") {
  return res.status(401).json({
    ok: false,
    error: message,
  })
}

async function getActiveMeraSession(sessionPublicId, meraUserId) {
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

export async function requireMeraAuth(req, res, next) {
  const authHeader = req.header("authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return unauthorized(res, "Missing MERA Bearer token")
  }

  const token = authHeader.slice("Bearer ".length)
  const secret = getMeraJwtSecretForMiddleware()
  if (!secret) return unauthorized(res, "MERA JWT secret is not configured")

  try {
    const payload = jwt.verify(token, secret)
    if (payload?.scope !== "mera") {
      return unauthorized(res, "Invalid MERA session scope")
    }
    const sessionPublicId = typeof payload?.sid === "string" ? payload.sid : null
    if (!sessionPublicId) {
      return unauthorized(res, "MERA session context is missing")
    }

    const activeSession = await getActiveMeraSession(sessionPublicId, payload.uid)
    if (!activeSession?.public_id) {
      return unauthorized(res, "MERA session revoked or expired")
    }
    prisma.$executeRaw`
      UPDATE mera_auth_sessions
      SET last_seen_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${activeSession.public_id}
    `.catch(() => {})

    const access = await getMeraUserAccessById(Number(payload.uid))
    if (!access?.id) {
      return unauthorized(res, "MERA user was not found")
    }
    if (String(access.accountStatus || "").trim().toUpperCase() !== "ACTIVE") {
      return unauthorized(res, "MERA account is not active")
    }

    req.meraAuth = {
      userId: Number(payload.uid),
      userPublicId: String(payload.sub || "").trim() || null,
      sessionPublicId: activeSession.public_id,
      fullName: access.fullName,
      email: access.email,
      role: access.role.code,
      roleDisplayName: access.role.displayName,
      permissions: access.permissions,
      districtScope: access.districtScope,
      regionScope: access.regionScope,
      accountStatus: access.accountStatus,
      ipAddress: (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
      deviceInfo: req.header("user-agent")?.slice(0, 255) || null,
    }
    return next()
  } catch (error) {
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError") {
      return unauthorized(res, "Invalid or expired MERA token")
    }
    return next(error)
  }
}

export function requireMeraRole(roles = []) {
  const normalizedRoles = normalizeRoleList(roles)

  return function checkMeraRole(req, res, next) {
    const activeRole = String(req.meraAuth?.role || "").trim().toUpperCase()
    if (!normalizedRoles.includes(activeRole)) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden",
      })
    }
    return next()
  }
}

export function requireMeraPermission(permissionCode) {
  const normalizedPermissions = Array.isArray(permissionCode)
    ? permissionCode
    : [permissionCode]

  return function checkMeraPermission(req, res, next) {
    const matchedPermission = normalizedPermissions.find((candidate) => hasMeraPermission(req.meraAuth, candidate))
    if (!matchedPermission) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden",
      })
    }
    req.meraPermission = String(matchedPermission).trim().toUpperCase()
    req.meraAuth.permissionUsed = req.meraPermission
    return next()
  }
}

export function requireDistrictScope(req, res, next) {
  const role = String(req.meraAuth?.role || "").trim().toUpperCase()
  const hasDistrictScope = Boolean(String(req.meraAuth?.districtScope || "").trim())

  if (
    [
      "REGIONAL_COMPLIANCE_SUPERVISOR",
      "FIELD_COMPLIANCE_OFFICER",
      "PUBLIC_COMPLAINTS_ANALYST",
    ].includes(role) &&
    !hasDistrictScope
  ) {
    return res.status(403).json({
      ok: false,
      error: "A district scope is required for this MERA account",
    })
  }

  return next()
}

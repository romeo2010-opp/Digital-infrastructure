import jwt from "jsonwebtoken"
import { prisma } from "../../db/prisma.js"
import { resolveEffectiveInternalPermissions } from "./permissions.js"

function unauthorized(res, message = "Unauthorized") {
  return res.status(401).json({
    ok: false,
    error: message,
  })
}

async function getActiveInternalSession(sessionPublicId, userId) {
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM internal_auth_sessions
    WHERE public_id = ${sessionPublicId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  return rows?.[0] || null
}

async function listInternalPermissionsForUser(userId) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ip.code
    FROM internal_user_roles iur
    INNER JOIN internal_roles ir ON ir.id = iur.role_id
    INNER JOIN internal_role_permissions irp ON irp.role_id = ir.id
    INNER JOIN internal_permissions ip ON ip.id = irp.permission_id
    WHERE iur.user_id = ${userId}
      AND iur.is_active = 1
      AND ir.is_active = 1
  `
  return (rows || []).map((row) => String(row.code || "").trim()).filter(Boolean)
}

async function listInternalRoleCodesForUser(userId) {
  const rows = await prisma.$queryRaw`
    SELECT ir.code
    FROM internal_user_roles iur
    INNER JOIN internal_roles ir ON ir.id = iur.role_id
    WHERE iur.user_id = ${userId}
      AND iur.is_active = 1
      AND ir.is_active = 1
    ORDER BY ir.rank_order ASC, ir.id ASC
  `
  return (rows || []).map((row) => String(row.code || "").trim()).filter(Boolean)
}

export async function requireInternalAuth(req, res, next) {
  const authHeader = req.header("authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return unauthorized(res, "Missing Bearer token")
  }

  const token = authHeader.slice("Bearer ".length)
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) return unauthorized(res, "JWT secret is not configured")

  try {
    const payload = jwt.verify(token, secret)
    if (payload?.scope !== "internal") {
      return unauthorized(res, "Invalid internal session scope")
    }
    const sessionPublicId = typeof payload?.sid === "string" ? payload.sid : null
    if (!sessionPublicId) return unauthorized(res, "Internal session context is missing")

    const activeSession = await getActiveInternalSession(sessionPublicId, payload.uid)
    if (!activeSession) {
      return unauthorized(res, "Internal session revoked or expired")
    }

    req.internalAuth = {
      userId: Number(payload.uid),
      userPublicId: String(payload.sub || "").trim() || null,
      sessionPublicId: activeSession.public_id,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      primaryRole: String(payload.primaryRole || "").trim() || null,
    }
    const roleCodes = await listInternalRoleCodesForUser(payload.uid)
    req.internalAuth.roles = roleCodes
    req.internalAuth.primaryRole = roleCodes[0] || req.internalAuth.primaryRole
    req.internalPermissions = new Set(
      resolveEffectiveInternalPermissions(roleCodes, await listInternalPermissionsForUser(payload.uid))
    )
    return next()
  } catch (error) {
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError") {
      return unauthorized(res, "Invalid or expired token")
    }
    return next(error)
  }
}

export function requireInternalPermission(permissionCode) {
  return function checkPermission(req, res, next) {
    const permissionSet = req.internalPermissions
    if (!(permissionSet instanceof Set) || !permissionSet.has(permissionCode)) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden",
      })
    }
    return next()
  }
}

export function requireAnyInternalPermission(permissionCodes = []) {
  const normalizedCodes = Array.isArray(permissionCodes)
    ? permissionCodes.map((item) => String(item || "").trim()).filter(Boolean)
    : []

  return function checkAnyPermission(req, res, next) {
    const permissionSet = req.internalPermissions
    const authorized = permissionSet instanceof Set && normalizedCodes.some((code) => permissionSet.has(code))
    if (!authorized) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden",
      })
    }
    return next()
  }
}

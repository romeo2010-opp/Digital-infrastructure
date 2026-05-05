import jwt from "jsonwebtoken"
import { prisma } from "../../../db/prisma.js"
import { getMeraJwtSecretForMiddleware } from "../services/auth.service.js"

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

    req.meraAuth = {
      userId: Number(payload.uid),
      userPublicId: String(payload.sub || "").trim() || null,
      sessionPublicId: activeSession.public_id,
      role: String(payload.role || "").trim().toUpperCase() || null,
      district: String(payload.district || "").trim() || null,
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
  const normalizedRoles = Array.isArray(roles)
    ? roles.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : []

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

import jwt from "jsonwebtoken"
import crypto from "crypto"
import { prisma } from "../db/prisma.js"
import { getStationSubscriptionAccess, isStationStaffRole } from "../modules/auth/stationSubscriptionAccess.js"

const DEFAULT_SESSION_CACHE_TTL_MS = Number(process.env.AUTH_SESSION_CACHE_TTL_MS || 3000)
const MAX_SESSION_CACHE_ENTRIES = Number(process.env.AUTH_SESSION_CACHE_MAX_ENTRIES || 1000)
const activeSessionCache = new Map()

function unauthorized(res, message = "Unauthorized") {
  return res.status(401).json({
    ok: false,
    error: message,
  })
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function resolveSessionCacheTtlMs() {
  return Number.isFinite(DEFAULT_SESSION_CACHE_TTL_MS) && DEFAULT_SESSION_CACHE_TTL_MS > 0 ? DEFAULT_SESSION_CACHE_TTL_MS : 0
}

function resolveMaxSessionCacheEntries() {
  return Number.isFinite(MAX_SESSION_CACHE_ENTRIES) && MAX_SESSION_CACHE_ENTRIES > 0
    ? Math.floor(MAX_SESSION_CACHE_ENTRIES)
    : 1000
}

function buildSessionCacheKey({ sessionPublicId, userId, stationId }) {
  if (!sessionPublicId) return null
  return [sessionPublicId, userId || "", stationId ?? ""].join("|")
}

function rememberActiveSession(cacheKey, session) {
  const ttlMs = resolveSessionCacheTtlMs()
  if (!cacheKey || ttlMs <= 0 || !session?.public_id) return

  activeSessionCache.set(cacheKey, {
    session,
    expiresAt: Date.now() + ttlMs,
  })

  const maxEntries = resolveMaxSessionCacheEntries()
  if (activeSessionCache.size <= maxEntries) return

  const now = Date.now()
  for (const [key, value] of activeSessionCache.entries()) {
    if (value.expiresAt <= now || activeSessionCache.size > maxEntries) {
      activeSessionCache.delete(key)
    }
    if (activeSessionCache.size <= maxEntries) break
  }
}

export function clearActiveSessionCacheForSessionPublicId(sessionPublicId) {
  const scopedSessionPublicId = String(sessionPublicId || "").trim()
  if (!scopedSessionPublicId) return

  const keyPrefix = `${scopedSessionPublicId}|`
  for (const cacheKey of activeSessionCache.keys()) {
    if (cacheKey.startsWith(keyPrefix)) {
      activeSessionCache.delete(cacheKey)
    }
  }
}

export function clearActiveSessionCacheForUser(userId) {
  const scopedUserId = String(userId || "").trim()
  if (!scopedUserId) return

  for (const cacheKey of activeSessionCache.keys()) {
    const [, cachedUserId] = cacheKey.split("|")
    if (cachedUserId === scopedUserId) {
      activeSessionCache.delete(cacheKey)
    }
  }
}

async function getActiveSession({ sessionPublicId, refreshTokenHash, userId, stationId }) {
  const cacheKey = buildSessionCacheKey({ sessionPublicId, refreshTokenHash, userId, stationId })
  const ttlMs = resolveSessionCacheTtlMs()
  const cached = cacheKey && ttlMs > 0 ? activeSessionCache.get(cacheKey) : null
  if (cached?.expiresAt > Date.now()) return cached.session
  if (cached) activeSessionCache.delete(cacheKey)

  let activeSession = null
  if (sessionPublicId) {
    const rows = await prisma.$queryRaw`
      SELECT public_id
      FROM auth_sessions
      WHERE public_id = ${sessionPublicId}
        AND user_id = ${userId}
        AND station_id <=> ${stationId}
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
      LIMIT 1
    `
    activeSession = rows?.[0] || null
    rememberActiveSession(cacheKey, activeSession)
    return activeSession
  }

  if (!refreshTokenHash) return null
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM auth_sessions
    WHERE refresh_token_hash = ${refreshTokenHash}
      AND user_id = ${userId}
      AND station_id <=> ${stationId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  activeSession = rows?.[0] || null
  rememberActiveSession(cacheKey, activeSession)
  return activeSession
}

export async function requireAuth(req, res, next) {
  const authHeader = req.header("authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return unauthorized(res, "Missing Bearer token")
  }

  const token = authHeader.slice("Bearer ".length)
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) {
    return unauthorized(res, "JWT secret is not configured")
  }

  try {
    const payload = jwt.verify(token, secret)
    const tokenSessionPublicId = typeof payload?.sid === "string" ? payload.sid : null
    const refreshToken = req.cookies?.sl_refresh
    const refreshTokenHash = refreshToken ? hashToken(refreshToken) : null
    if (!tokenSessionPublicId && !refreshTokenHash) {
      return unauthorized(res, "Session context is missing")
    }

    const activeSession = await getActiveSession({
      sessionPublicId: tokenSessionPublicId,
      refreshTokenHash,
      userId: payload.uid,
      stationId: payload.stationId,
    })
    if (!activeSession) {
      return unauthorized(res, "Session revoked or expired")
    }

    if (payload.stationId && isStationStaffRole(payload.role)) {
      const subscriptionAccess = await getStationSubscriptionAccess(payload.stationId)
      if (!subscriptionAccess.allowed) {
        return unauthorized(res, subscriptionAccess.message || "Station subscription access is blocked")
      }
    }

    req.auth = {
      userPublicId: payload.sub,
      userId: payload.uid,
      stationPublicId: payload.stationPublicId,
      stationId: payload.stationId,
      role: payload.role,
      sessionPublicId: activeSession.public_id,
    }
    return next()
  } catch (error) {
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError") {
      return unauthorized(res, "Invalid or expired token")
    }
    return next(error)
  }
}

export function requireRole(roles) {
  return function checkRole(req, res, next) {
    if (!req.auth?.role || !roles.includes(req.auth.role)) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden",
      })
    }
    return next()
  }
}

export function requireStationScope(req, res, next) {
  const routeStationPublicId = req.params.stationPublicId
  if (!routeStationPublicId) return next()

  if (req.auth?.stationPublicId !== routeStationPublicId) {
    return res.status(403).json({
      ok: false,
      error: "Station scope mismatch",
    })
  }

  return next()
}

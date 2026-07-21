import { HttpError } from "../utils/http.js"

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10
const attempts = new Map()

function loginKey(req) {
  const identifier = String(
    req.body?.email || req.body?.student_code || req.body?.studentCode || req.body?.admission_no || req.body?.admissionNo || "unknown",
  ).trim().toLowerCase()
  const school = String(req.body?.school_code || req.body?.schoolCode || req.body?.school_prefix || req.body?.schoolPrefix || "staff").trim().toLowerCase()
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${school}:${identifier}`
}

export function rateLimitLogin(req, res, next) {
  const now = Date.now()
  const key = loginKey(req)
  const current = attempts.get(key)
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current
  if (bucket.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    res.setHeader("Retry-After", String(retryAfterSeconds))
    const error = new HttpError(429, "Too many login attempts. Wait before trying again.", {
      code: "LOGIN_RATE_LIMITED",
      details: { retry_after_seconds: retryAfterSeconds },
    })
    error.retryAfterSeconds = retryAfterSeconds
    return next(error)
  }
  bucket.count += 1
  attempts.set(key, bucket)
  res.once("finish", () => { if (res.statusCode < 400) attempts.delete(key) })
  if (attempts.size > 10_000) {
    for (const [candidate, value] of attempts) if (value.resetAt <= now) attempts.delete(candidate)
  }
  return next()
}

export function resetLoginRateLimitForTests() {
  attempts.clear()
}

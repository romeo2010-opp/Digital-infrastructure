import cors from "cors"
import dotenv from "dotenv"
import express from "express"
import { randomUUID } from "crypto"
import path from "path"
import routes from "./routes/index.js"
import { normalizeDatabaseError } from "./utils/databaseErrors.js"
import { recordSystemError } from "./services/systemErrorService.js"

dotenv.config()

const app = express()

function corsOrigin() {
  const raw = String(process.env.CORS_ORIGIN || "").trim()
  const origins = raw.split(",").map(normalizeCorsOrigin).filter(Boolean)
  if (!origins.length) return true
  return (origin, callback) => {
    const normalizedOrigin = normalizeCorsOrigin(origin)
    if (!origin || origins.includes("*") || origins.includes(normalizedOrigin) || isTrustedDevOrigin(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`CORS origin not allowed: ${origin}`))
  }
}

function normalizeCorsOrigin(origin) {
  const value = String(origin || "").trim().replace(/^['"]|['"]$/g, "")
  if (!value || value === "*") return value
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/+$/, "")
  }
}

function isTrustedDevOrigin(origin) {
  try {
    const { hostname } = new URL(origin)
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i.test(hostname)) return true
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
    return [
      ".trycloudflare.com",
      ".cfargotunnel.com",
      ".ngrok-free.app",
      ".ngrok.app",
      ".loca.lt",
      ".localtunnel.me",
    ].some((suffix) => hostname.endsWith(suffix))
  } catch {
    return false
  }
}

app.use(cors({ origin: corsOrigin(), credentials: true }))
app.use(express.json({ limit: "60mb" }))
const publicUploads = express.static(path.resolve(process.cwd(), "uploads"))
app.use("/uploads", (req, res, next) => {
  if (String(req.path || "").startsWith("/teaching-resources/")) {
    res.status(404).json({ message: "Resource files require an authorised download request." })
    return
  }
  publicUploads(req, res, next)
})

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "smartlink-schools" })
})

app.use("/api", routes)

app.use((req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`)
  error.status = 404
  next(error)
})

app.use((incomingError, req, res, _next) => {
  const error = normalizeDatabaseError(incomingError)
  const status = error.status || 500
  const errorId = randomUUID()
  const originalCode = error?.cause?.code || error.code
  if (status >= 500 || String(originalCode || "").startsWith("ER_")) {
    void recordSystemError({ errorId, error, req, status })
  }
  if (status >= 500) {
    console.error("[smartlink-schools] request failed", {
      errorId,
      method: req.method,
      path: req.originalUrl,
      schoolId: req.user?.school_id || req.user?.schoolId || null,
      userId: req.user?.id || null,
      message: error.message,
      code: originalCode,
      sqlMessage: error.cause?.sqlMessage || error.sqlMessage,
      causeMessage: error.cause?.message,
      causeCode: error.cause?.code,
      stack: error.stack,
    })
  }
  res.status(status).json({
    message: status >= 500 && !error.expose
      ? `SmartLink could not complete this request. Reference: ${errorId}`
      : error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
    ...(status >= 500 ? { error_id: errorId } : {}),
  })
})

export default app

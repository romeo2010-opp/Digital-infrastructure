import cors from "cors"
import dotenv from "dotenv"
import express from "express"
import path from "path"
import routes from "./routes/index.js"

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
app.use(express.json({ limit: "8mb" }))
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")))

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "smartlink-schools" })
})

app.use("/api", routes)

app.use((req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`)
  error.status = 404
  next(error)
})

app.use((error, _req, res, _next) => {
  const status = error.status || 500
  if (status >= 500) {
    console.error("[smartlink-schools] request failed", {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: error.stack,
    })
  }
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : error.message,
  })
})

export default app

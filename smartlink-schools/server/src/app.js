import cors from "cors"
import dotenv from "dotenv"
import express from "express"
import path from "path"
import routes from "./routes/index.js"

dotenv.config()

const app = express()

function corsOrigin() {
  const raw = String(process.env.CORS_ORIGIN || "").trim()
  if (!raw) return true
  const origins = raw.split(",").map((origin) => origin.trim()).filter(Boolean)
  return origins.length > 1 ? origins : origins[0]
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
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : error.message,
  })
})

export default app

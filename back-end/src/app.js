import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import cookieParser from "cookie-parser"
import { requireAuth } from "./middleware/requireAuth.js"
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js"
import stationsRoutes from "./modules/stations/routes.js"
import queueRoutes from "./modules/queue/routes.js"
import userQueueRoutes from "./modules/userQueue/routes.js"
import pumpsRoutes from "./modules/pumps/routes.js"
import reportsRoutes from "./modules/reports/routes.js"
import reportsExportRoutes from "./modules/reports/reports.export.router.js"
import auditRoutes from "./modules/audit/routes.js"
import settingsRoutes from "./modules/settings/settings.router.js"
import transactionsRoutes from "./modules/transactions/routes.js"
import syncRoutes from "./modules/sync/routes.js"
import supportRoutes from "./modules/support/routes.js"
import monitoringRoutes, { monitoringGatewayRoutes } from "./modules/monitoring/routes.js"
import promotionsRoutes from "./modules/promotions/routes.js"
import attendantRoutes from "./modules/attendant/routes.js"
import assistantRoutes from "./modules/assistant/routes.js"
import fuelOrdersRoutes, { fuelOrderGatewayRoutes } from "./modules/fuelOrders/routes.js"
import transactionPublicRoutes from "./modules/transactions/public.routes.js"
import authRouter from "./modules/auth/auth.router.js"
import authApiRouter from "./modules/auth/auth.api.router.js"
import internalAuthRoutes from "./modules/internal/auth.routes.js"
import internalChatRoutes from "./modules/internal/chat.routes.js"
import internalRoutes from "./modules/internal/routes.js"
import { requireInternalAuth } from "./modules/internal/middleware.js"

export const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const serveFrontend = String(process.env.SERVE_FRONTEND || "false").toLowerCase() === "true"
const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.cwd(), process.env.FRONTEND_DIST_PATH)
  : path.resolve(__dirname, "../../front-end/dist")
const frontendIndexPath = path.join(frontendDistPath, "index.html")
const hasFrontendBuild = fs.existsSync(frontendIndexPath)

app.use(helmet())
app.use(
  cors({
    origin: true,
    credentials: true,
  })
)
app.use(express.json({ limit: "6mb" }))
app.use(cookieParser())
app.use(morgan("dev"))

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    data: { status: "healthy" },
  })
})

app.get("/api/health", (_req, res) => {
  res.json({ ok: true })
})

app.use(transactionPublicRoutes)
app.use(fuelOrderGatewayRoutes)
app.use(monitoringGatewayRoutes)

const apiRouter = express.Router()
apiRouter.use(stationsRoutes)
apiRouter.use(queueRoutes)
apiRouter.use(userQueueRoutes)
apiRouter.use(pumpsRoutes)
apiRouter.use(reportsRoutes)
apiRouter.use(reportsExportRoutes)
apiRouter.use(auditRoutes)
apiRouter.use(settingsRoutes)
apiRouter.use(transactionsRoutes)
apiRouter.use(syncRoutes)
apiRouter.use(supportRoutes)
apiRouter.use(monitoringRoutes)
apiRouter.use(promotionsRoutes)
apiRouter.use(attendantRoutes)
apiRouter.use(assistantRoutes)
apiRouter.use(fuelOrdersRoutes)
apiRouter.use(authApiRouter)

app.use("/auth", authRouter)
app.use("/api/internal/auth", internalAuthRoutes)
app.use("/api/internal/chat", requireInternalAuth, internalChatRoutes)
app.use("/api/internal", requireInternalAuth, internalRoutes)
app.use("/api", requireAuth, apiRouter)

if (serveFrontend && hasFrontendBuild) {
  app.use(
    express.static(frontendDistPath, {
      index: false,
      maxAge: "1h",
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store")
        }
      },
    })
  )

  app.get("*", (req, res, next) => {
    if (req.method !== "GET") return next()
    if (req.path === "/health") return next()
    if (req.path.startsWith("/auth")) return next()
    if (req.path.startsWith("/api")) return next()
    res.sendFile(frontendIndexPath, (error) => {
      if (error) next(error)
    })
  })
} else if (serveFrontend && !hasFrontendBuild) {
  // eslint-disable-next-line no-console
  console.warn(`[boot] SERVE_FRONTEND=true but frontend build is missing: ${frontendIndexPath}`)
}

app.use(notFoundHandler)
app.use(errorHandler)

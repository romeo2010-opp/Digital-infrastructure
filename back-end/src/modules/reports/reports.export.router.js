import { Router } from "express"
import { exportCsvHandler, exportPdfHandler } from "./reports.export.controller.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"

const router = Router()

router.get(
  "/stations/:stationPublicId/reports/export/csv",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.REPORTS_EXPORT),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  exportCsvHandler
)

router.get(
  "/stations/:stationPublicId/reports/export/pdf",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.REPORTS_EXPORT),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  exportPdfHandler
)

export default router

import { Router } from "express"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import * as settingsController from "./settings.controller.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import {
  nozzleCreateSchema,
  nozzlePatchSchema,
  pumpCreateSchema,
  pumpPatchSchema,
  queuePatchSchema,
  staffPatchSchema,
  userDeleteRequestSchema,
  userPreferencesPatchSchema,
  stationPatchSchema,
  tankCreateSchema,
  tankPatchSchema,
  userMePatchSchema,
} from "./settings.schemas.js"

const router = Router()

router.get(
  "/stations/:stationPublicId/settings",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => settingsController.getSettings(req, res))
)

router.patch(
  "/stations/:stationPublicId/settings/station",
  requireStationScope,
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = stationPatchSchema.parse(req.body || {})
    return settingsController.patchStation(req, res)
  })
)

router.get(
  "/stations/:stationPublicId/settings/tanks",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => settingsController.getTanks(req, res))
)

router.post(
  "/stations/:stationPublicId/settings/tanks",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = tankCreateSchema.parse(req.body || {})
    return settingsController.createTank(req, res)
  })
)

router.patch(
  "/stations/:stationPublicId/settings/tanks/:tankPublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = tankPatchSchema.parse(req.body || {})
    return settingsController.patchTank(req, res)
  })
)

router.get(
  "/stations/:stationPublicId/settings/pumps",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => settingsController.getPumps(req, res))
)

router.post(
  "/stations/:stationPublicId/settings/pumps",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = pumpCreateSchema.parse(req.body || {})
    return settingsController.createPump(req, res)
  })
)

router.patch(
  "/stations/:stationPublicId/settings/pumps/:pumpPublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = pumpPatchSchema.parse(req.body || {})
    return settingsController.patchPump(req, res)
  })
)

router.delete(
  "/stations/:stationPublicId/settings/pumps/:pumpPublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => settingsController.deletePump(req, res))
)

router.post(
  "/stations/:stationPublicId/settings/pumps/:pumpPublicId/nozzles",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = nozzleCreateSchema.parse(req.body || {})
    return settingsController.createPumpNozzle(req, res)
  })
)

router.patch(
  "/stations/:stationPublicId/settings/nozzles/:nozzlePublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = nozzlePatchSchema.parse(req.body || {})
    return settingsController.patchPumpNozzle(req, res)
  })
)

router.delete(
  "/stations/:stationPublicId/settings/nozzles/:nozzlePublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => settingsController.deletePumpNozzle(req, res))
)

router.get(
  "/stations/:stationPublicId/settings/staff",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => settingsController.getStaff(req, res))
)

router.patch(
  "/stations/:stationPublicId/settings/staff/:staffId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.SETTINGS_CORE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = staffPatchSchema.parse(req.body || {})
    return settingsController.patchStaff(req, res)
  })
)

router.patch(
  "/stations/:stationPublicId/settings/queue",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    req.body = queuePatchSchema.parse(req.body || {})
    return settingsController.patchQueue(req, res)
  })
)

router.patch(
  "/users/me",
  asyncHandler(async (req, res) => {
    req.body = userMePatchSchema.parse(req.body || {})
    return settingsController.patchMe(req, res)
  })
)

router.get(
  "/users/me",
  asyncHandler(async (req, res) => settingsController.getMe(req, res))
)

router.get(
  "/users/me/preferences",
  asyncHandler(async (req, res) => settingsController.getMyPreferences(req, res))
)

router.patch(
  "/users/me/preferences",
  asyncHandler(async (req, res) => {
    req.body = userPreferencesPatchSchema.parse(req.body || {})
    return settingsController.patchMyPreferences(req, res)
  })
)

router.get(
  "/users/me/export",
  asyncHandler(async (req, res) => settingsController.exportMyData(req, res))
)

router.post(
  "/users/me/delete-request",
  asyncHandler(async (req, res) => {
    req.body = userDeleteRequestSchema.parse(req.body || {})
    return settingsController.requestDeleteMyAccount(req, res)
  })
)

export default router

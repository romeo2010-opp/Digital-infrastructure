import { Router } from "express"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { changePasswordSchema, switchStationSchema } from "./auth.schemas.js"
import * as authController from "./auth.controller.js"

const router = Router()

router.post(
  "/auth/stations/switch",
  asyncHandler(async (req, res) => {
    req.body = switchStationSchema.parse(req.body || {})
    return authController.switchStation(req, res)
  })
)

router.post(
  "/auth/change-password",
  asyncHandler(async (req, res) => {
    req.body = changePasswordSchema.parse(req.body || {})
    return authController.changePassword(req, res)
  })
)

router.get(
  "/auth/sessions",
  asyncHandler(async (req, res) => authController.listSessions(req, res))
)

router.post(
  "/auth/logout",
  asyncHandler(async (req, res) => authController.logoutApi(req, res))
)

router.post(
  "/auth/logout-others",
  asyncHandler(async (req, res) => authController.logoutOthers(req, res))
)

export default router

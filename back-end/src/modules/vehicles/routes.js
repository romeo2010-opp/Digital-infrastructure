import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import {
  TANK_SIDE_CONFIDENCES,
  TANK_SIDE_SOURCES,
  TANK_SIDES,
  VEHICLE_FUEL_TYPES,
  VEHICLE_TYPES,
  VEHICLE_USAGE_TYPES,
  archiveVehicle,
  createVehicle,
  getVehicle,
  listVehicles,
  setDefaultVehicle,
  updateVehicle,
} from "./service.js"

const router = Router()

const vehicleIdParamsSchema = z.object({
  vehicleId: z.string().trim().min(1).max(64),
})

const vehicleSchema = z.object({
  nickname: z.string().trim().max(120).nullable().optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  usageType: z.enum(VEHICLE_USAGE_TYPES).nullable().optional(),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
  year: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  numberPlate: z.string().trim().min(1).max(32),
  fuelType: z.enum(VEHICLE_FUEL_TYPES),
  tankCapacityLitres: z.coerce.number().positive().max(5000).nullable().optional(),
  isFullTank: z.coerce.boolean().optional(),
  tankSide: z.enum(TANK_SIDES),
  tankSideSource: z.enum(TANK_SIDE_SOURCES).optional(),
  tankSideConfidence: z.enum(TANK_SIDE_CONFIDENCES).optional(),
  visualMockupKey: z.string().trim().max(96).nullable().optional(),
  isDefault: z.coerce.boolean().optional(),
})

const updateVehicleSchema = vehicleSchema.partial()

router.get(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const data = await listVehicles({ auth: req.auth })
    return ok(res, data)
  })
)

router.post(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const payload = vehicleSchema.parse(req.body || {})
    const data = await createVehicle({ auth: req.auth, payload })
    return ok(res, data, 201)
  })
)

router.get(
  "/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const data = await getVehicle({ auth: req.auth, vehicleId: params.vehicleId })
    return ok(res, data)
  })
)

router.patch(
  "/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const payload = updateVehicleSchema.parse(req.body || {})
    const data = await updateVehicle({ auth: req.auth, vehicleId: params.vehicleId, payload })
    return ok(res, data)
  })
)

router.delete(
  "/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const data = await archiveVehicle({ auth: req.auth, vehicleId: params.vehicleId })
    return ok(res, data)
  })
)

router.post(
  "/vehicles/:vehicleId/set-default",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const data = await setDefaultVehicle({ auth: req.auth, vehicleId: params.vehicleId })
    return ok(res, data)
  })
)

export default router

import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import {
  archivePromotionCampaign,
  createPromotionCampaign,
  getPromotionPricingPreview,
  listStationPromotionCampaigns,
  listUserFacingPromotionsPreview,
  setPromotionCampaignActiveState,
  updatePromotionCampaign,
} from "./service.js"

const router = Router()

const paymentMethodSchema = z.enum(["CASH", "MOBILE_MONEY", "CARD", "OTHER", "SMARTPAY"])

const eligibilityRulesSchema = z.object({
  minLitres: z.number().positive().max(1000).optional(),
  maxLitres: z.number().positive().max(1000).optional(),
  paymentMethods: z.array(paymentMethodSchema).max(6).optional(),
  daysOfWeek: z
    .array(z.enum(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]))
    .max(7)
    .optional(),
  startHour: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endHour: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  requiresUser: z.boolean().optional(),
  requiresSmartPay: z.boolean().optional(),
}).optional()

const promotionBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  campaignLabel: z.string().trim().max(120).optional(),
  promotionKind: z.enum(["DISCOUNT", "FLASH_PRICE", "CASHBACK"]).default("DISCOUNT"),
  fuelTypeCode: z.enum(["PETROL", "DIESEL"]).optional(),
  fundingSource: z.enum(["STATION", "SMARTLINK", "SHARED"]).default("STATION"),
  stationSharePct: z.number().min(0).max(100).optional(),
  smartlinkSharePct: z.number().min(0).max(100).optional(),
  discountMode: z
    .enum(["PERCENTAGE_PER_LITRE", "FIXED_PER_LITRE", "FIXED_BASKET", "FLASH_PRICE_PER_LITRE"])
    .optional(),
  discountValue: z.number().positive().max(1000000).optional(),
  cashbackMode: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
  cashbackValue: z.number().positive().max(1000000).optional(),
  cashbackDestination: z.enum(["WALLET", "LOYALTY", "NONE"]).optional(),
  flashPricePerLitre: z.number().positive().max(1000000).optional(),
  startsAt: z.string().trim().min(8),
  endsAt: z.string().trim().min(8),
  isActive: z.boolean().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),
  maxRedemptions: z.number().int().positive().max(100000).optional(),
  maxLitres: z.number().positive().max(1000000).optional(),
  eligibilityRules: eligibilityRulesSchema,
})

const promotionPatchSchema = promotionBodySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one promotion field is required.",
})

const previewSchema = z.object({
  fuelTypeCode: z.enum(["PETROL", "DIESEL"]),
  litres: z.number().positive().max(500),
  paymentMethod: paymentMethodSchema.optional(),
  cashbackDestination: z.enum(["WALLET", "LOYALTY", "NONE"]).optional(),
})

const userPreviewQuerySchema = z.object({
  fuelTypeCode: z.enum(["PETROL", "DIESEL"]),
  litres: z.coerce.number().positive().max(500).optional(),
  paymentMethod: paymentMethodSchema.optional(),
})

router.get(
  "/stations/:stationPublicId/promotions",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const snapshot = await listStationPromotionCampaigns(req.params.stationPublicId)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/promotions",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const body = promotionBodySchema.parse(req.body || {})
    const created = await createPromotionCampaign(req.params.stationPublicId, body, req.auth)
    return ok(res, created, 201)
  })
)

router.patch(
  "/stations/:stationPublicId/promotions/:campaignPublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const body = promotionPatchSchema.parse(req.body || {})
    const updated = await updatePromotionCampaign(
      req.params.stationPublicId,
      req.params.campaignPublicId,
      body
    )
    return ok(res, updated)
  })
)

router.post(
  "/stations/:stationPublicId/promotions/:campaignPublicId/activate",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const updated = await setPromotionCampaignActiveState(
      req.params.stationPublicId,
      req.params.campaignPublicId,
      true
    )
    return ok(res, updated)
  })
)

router.post(
  "/stations/:stationPublicId/promotions/:campaignPublicId/deactivate",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const updated = await setPromotionCampaignActiveState(
      req.params.stationPublicId,
      req.params.campaignPublicId,
      false
    )
    return ok(res, updated)
  })
)

router.delete(
  "/stations/:stationPublicId/promotions/:campaignPublicId",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const result = await archivePromotionCampaign(
      req.params.stationPublicId,
      req.params.campaignPublicId
    )
    return ok(res, result)
  })
)

router.post(
  "/stations/:stationPublicId/promotions/preview",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const body = previewSchema.parse(req.body || {})
    const preview = await getPromotionPricingPreview({
      stationPublicId: req.params.stationPublicId,
      fuelTypeCode: body.fuelTypeCode,
      litres: body.litres,
      paymentMethod: body.paymentMethod || "CASH",
      userId: req.auth?.userId || null,
      cashbackDestination: body.cashbackDestination || "WALLET",
    })
    return ok(res, preview)
  })
)

router.get(
  "/user/stations/:stationPublicId/promotions/preview",
  asyncHandler(async (req, res) => {
    const query = userPreviewQuerySchema.parse(req.query || {})
    const preview = await listUserFacingPromotionsPreview({
      stationPublicId: req.params.stationPublicId,
      fuelTypeCode: query.fuelTypeCode,
      litres: query.litres || 20,
      paymentMethod: query.paymentMethod || "CASH",
      userId: req.auth?.userId || null,
    })
    return ok(res, preview)
  })          
)

export default router

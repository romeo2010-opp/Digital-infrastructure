import { Router } from "express"
import { requireStationScope } from "../../middleware/requireAuth.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { generateStationBriefing } from "./service.js"

const router = Router()

router.get(
  "/stations/:stationPublicId/briefing",
  requireStationScope,
  asyncHandler(async (req, res) => {
    const data = await generateStationBriefing({
      stationPublicId: req.params.stationPublicId,
      auth: req.auth,
    })
    return ok(res, data)
  })
)

export default router

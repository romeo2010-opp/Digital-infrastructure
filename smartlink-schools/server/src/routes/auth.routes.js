import { Router } from "express"
import { changePassword, login, me } from "../controllers/authController.js"
import { requireAuth } from "../middleware/auth.js"
import { asyncHandler } from "../utils/http.js"

const router = Router()

router.post("/login", asyncHandler(login))
router.get("/me", requireAuth, asyncHandler(me))
router.post("/change-password", requireAuth, asyncHandler(changePassword))

export default router

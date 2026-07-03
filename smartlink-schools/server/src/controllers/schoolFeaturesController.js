import { pool } from "../config/db.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { getSchoolFeatures, saveSchoolFeatures } from "../services/schoolFeaturesService.js"

export async function getSchoolFeaturesController(req, res) {
  const schoolId = getScopedSchoolId(req)
  const features = await getSchoolFeatures(pool, schoolId)
  res.json({ features })
}

export async function updateSchoolFeaturesController(req, res) {
  const schoolId = getScopedSchoolId(req)
  const features = await saveSchoolFeatures(pool, schoolId, req.body?.features || req.body || {})
  res.json({ features })
}

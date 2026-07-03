import { pool } from "../config/db.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { getReportPdfSettings, saveReportPdfSettings } from "../services/reportSettingsService.js"

export async function getReportPdfSettingsController(req, res) {
  const schoolId = getScopedSchoolId(req)
  const settings = await getReportPdfSettings(pool, schoolId)
  res.json(settings)
}

export async function updateReportPdfSettingsController(req, res) {
  const schoolId = getScopedSchoolId(req)
  const settings = await saveReportPdfSettings(pool, schoolId, req.body || {})
  res.json(settings)
}

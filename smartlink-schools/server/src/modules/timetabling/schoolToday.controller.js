import { getSchoolToday, getTodayAlerts, getTodayExams } from "./schoolToday.service.js"

async function send(res, payload, status = 200) {
  res.status(status).json(payload)
}

export async function getSchoolTodayController(req, res) {
  return send(res, await getSchoolToday(req))
}

export async function getSchoolTodayClassController(req, res) {
  return send(res, await getSchoolToday(req, { type: "class", id: req.params.classId }))
}

export async function getSchoolTodayTeacherController(req, res) {
  return send(res, await getSchoolToday(req, { type: "teacher", id: req.params.teacherId }))
}

export async function getSchoolTodayFacilityController(req, res) {
  return send(res, await getSchoolToday(req, { type: "facility", id: req.params.facilityId }))
}

export async function getSchoolTodayExamsController(req, res) {
  return send(res, await getTodayExams(req))
}

export async function getSchoolTodayAlertsController(req, res) {
  return send(res, await getTodayAlerts(req))
}

export async function recalculateSchoolTodayController(req, res) {
  return send(res, await getSchoolToday(req))
}


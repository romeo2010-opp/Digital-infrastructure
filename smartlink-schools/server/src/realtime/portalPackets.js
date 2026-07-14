import { getDashboard } from "../controllers/dashboardController.js"
import { listStudents } from "../controllers/studentsController.js"
import { listFeeAccounts } from "../controllers/feesController.js"
import { listAttendance } from "../controllers/attendanceController.js"
import { listHomework } from "../controllers/homeworkController.js"
import { topicInsights } from "../controllers/assessmentController.js"
import { listResults } from "../controllers/schoolDataController.js"
import { listForecasts } from "../controllers/forecastController.js"
import { getStudentPortal } from "../controllers/studentPortalController.js"
import { HttpError } from "../utils/http.js"

const packetKeys = new Set(["schoolDashboard", "studentPortal"])
const schoolDashboardRoles = new Set(["school_owner", "headteacher", "teacher", "bursar", "librarian", "super_admin"])

function canUsePacket(user, key) {
  const role = String(user?.role || "").toLowerCase()
  if (key === "studentPortal") return role === "student"
  if (key === "schoolDashboard") return schoolDashboardRoles.has(role)
  return false
}

function roleIn(user, roles) {
  return roles.includes(String(user?.role || "").toLowerCase())
}

async function capture(controller, user, { query = {}, params = {}, body = {} } = {}) {
  let statusCode = 200
  let payload
  const req = { user, query, params, body, headers: {} }
  const res = {
    status(code) {
      statusCode = Number(code) || 200
      return this
    },
    json(value) {
      payload = value
      return value
    },
  }
  await controller(req, res)
  if (statusCode >= 400) throw new HttpError(statusCode, payload?.message || "Packet request failed")
  return payload
}

async function safeCapture(controller, user, fallback, options) {
  try {
    return await capture(controller, user, options)
  } catch {
    return fallback
  }
}

export function normalizePortalPacketKeys(keys) {
  const raw = Array.isArray(keys) ? keys : String(keys || "").split(",")
  return [...new Set(raw.map((key) => String(key || "").trim()).filter((key) => packetKeys.has(key)))]
}

export async function getPortalPacket(user, key, params = {}) {
  if (!canUsePacket(user, key)) throw new HttpError(403, "Forbidden realtime packet")

  if (key === "studentPortal") {
    const payload = await capture(getStudentPortal, user, { query: params })
    return payload?.student_portal || payload
  }

  const feesAllowed = roleIn(user, ["school_owner", "headteacher", "bursar", "super_admin"])
  const [
    dashboard,
    students,
    fees,
    attendance,
    homework,
    insights,
    results,
    forecasts,
  ] = await Promise.all([
    safeCapture(getDashboard, user, {}, { query: params.dashboard || {} }),
    safeCapture(listStudents, user, { students: [] }, { query: params.students || {} }),
    feesAllowed ? safeCapture(listFeeAccounts, user, { feeAccounts: [] }, { query: params.fees || {} }) : { feeAccounts: [] },
    safeCapture(listAttendance, user, { attendance: [] }, { query: params.attendance || {} }),
    safeCapture(listHomework, user, { homework: [] }, { query: params.homework || {} }),
    safeCapture(topicInsights, user, { topics: [] }, { query: params.insights || {} }),
    safeCapture(listResults, user, { results: [] }, { query: params.results || {} }),
    safeCapture(listForecasts, user, { forecasts: [] }, { query: params.forecasts || {} }),
  ])

  return { dashboard, students, fees, attendance, homework, insights, results, forecasts }
}

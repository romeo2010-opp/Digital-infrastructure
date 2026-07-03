import { HttpError } from "../../utils/http.js"

function solverBaseUrl() {
  return String(process.env.TIMETABLE_SOLVER_URL || "http://127.0.0.1:7317").replace(/\/+$/, "")
}

function solverToken() {
  return String(process.env.TIMETABLE_SOLVER_INTERNAL_TOKEN || "dev-timetable-solver-token").trim()
}

function timeoutMs() {
  const seconds = Number(process.env.TIMETABLE_SOLVER_TIMEOUT_SECONDS || 60)
  return Math.max(5, Math.min(300, Number.isFinite(seconds) ? seconds : 60)) * 1000
}

async function requestSolver(pathname, { method = "GET", body = null } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const response = await fetch(`${solverBaseUrl()}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${solverToken()}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null
    if (!response.ok) {
      const detail = payload?.detail || payload?.message || `Solver returned ${response.status}`
      throw new HttpError(response.status === 401 ? 503 : response.status, `Timetable solver error: ${detail}`)
    }
    return payload
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error?.name === "AbortError") {
      throw new HttpError(504, "Timetable solver timed out. Try a smaller scope or increase the solver timeout.")
    }
    throw new HttpError(503, "Timetable solver is unavailable. Start the timetable-solver service and try again.")
  } finally {
    clearTimeout(timer)
  }
}

export const TimetableSolverClient = {
  healthCheck() {
    return requestSolver("/health")
  },
  generateSchoolTimetable(payload) {
    return requestSolver("/solve/school-timetable", { method: "POST", body: payload })
  },
  generateExamTimetable(payload) {
    return requestSolver("/solve/exam-timetable", { method: "POST", body: payload })
  },
  allocateExamRooms(payload) {
    return requestSolver("/solve/exam-room-allocation", { method: "POST", body: payload })
  },
  allocateInvigilators(payload) {
    return requestSolver("/solve/invigilation", { method: "POST", body: payload })
  },
  findAlternativeSlots(payload) {
    return requestSolver("/solve/alternative-slots", { method: "POST", body: payload })
  },
  getTodayIntelligence(payload) {
    return requestSolver("/intelligence/today", { method: "POST", body: payload })
  },
}


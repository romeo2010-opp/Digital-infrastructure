import { broadcastPortalInvalidation } from "./websocketServer.js"

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])
const allPortalPackets = ["schoolDashboard", "studentPortal"]

function normalizeId(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function requestPath(req) {
  const path = String(req.path || req.originalUrl || "/").split("?")[0] || "/"
  return path.replace(/^\/api(?=\/|$)/, "") || "/"
}

function requestSchoolId(req) {
  return normalizeId(req.user?.schoolId)
    || normalizeId(req.body?.school_id)
    || normalizeId(req.body?.schoolId)
    || normalizeId(req.query?.school_id)
    || normalizeId(req.query?.schoolId)
}

function routeTarget(req) {
  const path = requestPath(req)

  if (path === "/ai/test") return null

  if (path.startsWith("/preferences/me")) {
    return {
      keys: [],
      resources: ["preferences"],
      userId: req.user?.id,
      reason: "preferences-updated",
    }
  }

  if (path.startsWith("/student-portal")) {
    return {
      keys: ["studentPortal"],
      resources: ["studentPortal"],
      reason: "student-portal-updated",
    }
  }

  if (path.startsWith("/internal/exam-lab")) {
    return {
      keys: [],
      resources: ["examLab"],
      schoolScoped: false,
      reason: "exam-lab-updated",
    }
  }

  if (path.startsWith("/timetables") || path.startsWith("/exam-timetables") || path.startsWith("/scheduling")) {
    return {
      keys: allPortalPackets,
      resources: ["timetables", "schoolData"],
      reason: "timetable-updated",
    }
  }

  return {
    keys: allPortalPackets,
    resources: ["schoolData"],
    reason: "school-data-updated",
  }
}

export function portalMutationInvalidationMiddleware(req, res, next) {
  if (!mutationMethods.has(String(req.method || "").toUpperCase())) {
    next()
    return
  }

  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return
    if (!req.user) return

    const target = routeTarget(req)
    if (!target) return

    broadcastPortalInvalidation({
      schoolId: target.schoolScoped === false ? null : requestSchoolId(req),
      userId: target.userId || null,
      keys: target.keys || [],
      resources: target.resources || [],
      reason: target.reason || "mutation",
      actorUserId: req.user.id,
    })
  })

  next()
}

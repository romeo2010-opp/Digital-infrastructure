import jwt from "jsonwebtoken"
import { HttpError } from "../utils/http.js"

const roleRank = {
  super_admin: 7,
  school_owner: 6,
  headteacher: 5,
  bursar: 4,
  teacher: 3,
  parent: 2,
  student: 1,
}

export function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      schoolId: user.schoolId,
      role: user.role,
      email: user.email,
      fullName: user.fullName,
      mustChangePassword: Boolean(user.mustChangePassword),
      studentId: user.studentId || null,
      studentCode: user.studentCode || null,
      admissionNo: user.admissionNo || null,
      classId: user.classId || null,
    },
    process.env.JWT_SECRET || "smartlink-schools-dev-secret",
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" },
  )
}

export function verifySessionToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET || "smartlink-schools-dev-secret")
  return {
    id: Number(payload.sub),
    schoolId: payload.schoolId ? Number(payload.schoolId) : null,
    role: payload.role,
    email: payload.email,
    fullName: payload.fullName,
    mustChangePassword: Boolean(payload.mustChangePassword),
    studentId: payload.studentId ? Number(payload.studentId) : null,
    studentCode: payload.studentCode || null,
    admissionNo: payload.admissionNo || null,
    classId: payload.classId ? Number(payload.classId) : null,
  }
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null

  if (!token) {
    throw new HttpError(401, "Authentication required")
  }

  try {
    req.user = verifySessionToken(token)
    next()
  } catch (_error) {
    throw new HttpError(401, "Invalid or expired session")
  }
}

export function requirePasswordReady(req, _res, next) {
  if (!req.user) throw new HttpError(401, "Authentication required")
  if (req.user.mustChangePassword) {
    throw new HttpError(403, "Password change required before accessing SmartLink Schools.")
  }
  next()
}

export function requireRole(...allowedRoles) {
  return function roleGuard(req, _res, next) {
    if (!req.user) throw new HttpError(401, "Authentication required")
    if (req.user.role === "super_admin") return next()
    if (allowedRoles.includes(req.user.role)) return next()
    throw new HttpError(403, "Insufficient role permissions")
  }
}

export function requireMinimumRole(minimumRole) {
  return function rankGuard(req, _res, next) {
    if (!req.user) throw new HttpError(401, "Authentication required")
    if ((roleRank[req.user.role] || 0) < (roleRank[minimumRole] || 0)) {
      throw new HttpError(403, "Insufficient role permissions")
    }
    next()
  }
}

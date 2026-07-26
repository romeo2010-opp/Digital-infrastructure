import jwt from "jsonwebtoken"
import { HttpError } from "../utils/http.js"
import { loadTeamPrincipal } from "../services/teamAccessService.js"

const TEAM_AUDIENCE = "smartlink-team-suite"
const TEAM_ISSUER = "smartlink-schools-api"

function teamJwtSecret() {
  const configured = String(process.env.TEAM_JWT_SECRET || process.env.JWT_SECRET || "").trim()
  if (configured) return `${configured}:team-suite`
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new HttpError(503, "Team Suite authentication is not configured", { code: "TEAM_AUTH_NOT_CONFIGURED" })
  }
  return "smartlink-team-suite-local-development-only"
}

export function signTeamSession(user) {
  return jwt.sign(
    { sub: String(user.id), workspace: "team" },
    teamJwtSecret(),
    {
      audience: TEAM_AUDIENCE,
      issuer: TEAM_ISSUER,
      expiresIn: process.env.TEAM_JWT_EXPIRES_IN || "8h",
    },
  )
}

export function verifyTeamSessionToken(token) {
  const payload = jwt.verify(token, teamJwtSecret(), {
    audience: TEAM_AUDIENCE,
    issuer: TEAM_ISSUER,
  })
  if (payload.workspace !== "team" || !payload.sub) throw new Error("Wrong workspace")
  return { id: Number(payload.sub), workspace: "team" }
}

export function requireTeamAuth(req, _res, next) {
  const header = String(req.headers.authorization || "")
  const token = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!token) return next(new HttpError(401, "Team authentication required"))
  let identity
  try {
    identity = verifyTeamSessionToken(token)
  } catch (error) {
    if (error instanceof HttpError) return next(error)
    return next(new HttpError(401, "Invalid or expired Team Suite session"))
  }
  loadTeamPrincipal(identity.id)
    .then((user) => { req.teamUser = user; next() })
    .catch(next)
}

export function requireTeamPasswordReady(req, _res, next) {
  if (!req.teamUser) throw new HttpError(401, "Team authentication required")
  if (req.teamUser.mustChangePassword) {
    throw new HttpError(403, "Password change required before accessing SmartLink Team Suite", {
      code: "TEAM_PASSWORD_CHANGE_REQUIRED",
    })
  }
  next()
}

export function safeTeamRequestMetadata(req) {
  return {
    ipAddress: String(req.ip || req.socket?.remoteAddress || "").slice(0, 64) || null,
    userAgent: String(req.get?.("user-agent") || "").slice(0, 500) || null,
  }
}

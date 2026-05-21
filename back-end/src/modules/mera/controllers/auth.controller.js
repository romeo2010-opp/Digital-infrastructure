import { ok } from "../../../utils/http.js"
import * as authService from "../services/auth.service.js"
import { logMeraAudit } from "../services/audit.service.js"

export async function login(req, res) {
  const payload = await authService.login({ payload: req.body, req })
  if (payload?.challengeRequired) {
    await logMeraAudit({
      actorRole: "UNKNOWN",
      permissionUsed: "AUTH_LOGIN_CODE",
      actionType: "MERA_LOGIN_CODE_SENT",
      actionDescription: `MERA login code sent to ${payload?.maskedEmail || "masked email"}.`,
      affectedEntity: payload?.challengeId || null,
      ipAddress: req.meraAuth?.ipAddress || (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
      deviceInfo: req.header("user-agent")?.slice(0, 255) || null,
    })
    return ok(res, payload)
  }

  await logMeraAudit({
    actorName: payload?.user?.fullName || null,
    actorRole: payload?.user?.role || "UNKNOWN",
    permissionUsed: "AUTH_LOGIN",
    actionType: "MERA_LOGIN",
    actionDescription: `MERA login for ${payload?.user?.email || "unknown user"}.`,
    affectedEntity: payload?.user?.publicId || payload?.user?.email || null,
    ipAddress: req.meraAuth?.ipAddress || (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
    deviceInfo: req.header("user-agent")?.slice(0, 255) || null,
  })
  return ok(res, payload)
}

export async function verifyLoginCode(req, res) {
  const result = await authService.verifyLoginCode({ payload: req.body, req })
  if (result?.trustedDeviceCookie) {
    res.cookie(
      result.trustedDeviceCookie.name,
      result.trustedDeviceCookie.value,
      result.trustedDeviceCookie.options,
    )
  }

  const payload = result.session
  await logMeraAudit({
    actorName: payload?.user?.fullName || null,
    actorRole: payload?.user?.role || "UNKNOWN",
    permissionUsed: "AUTH_LOGIN_CODE",
    actionType: "MERA_LOGIN",
    actionDescription: `MERA login for ${payload?.user?.email || "unknown user"} after email code verification.`,
    affectedEntity: payload?.user?.publicId || payload?.user?.email || null,
    ipAddress: req.meraAuth?.ipAddress || (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
    deviceInfo: req.header("user-agent")?.slice(0, 255) || null,
  })
  return ok(res, payload)
}

export async function resendLoginCode(req, res) {
  const payload = await authService.resendLoginCode({ payload: req.body, req })
  await logMeraAudit({
    actorRole: "UNKNOWN",
    permissionUsed: "AUTH_LOGIN_CODE",
    actionType: "MERA_LOGIN_CODE_RESENT",
    actionDescription: `MERA login code resent to ${payload?.maskedEmail || "masked email"}.`,
    affectedEntity: payload?.challengeId || null,
    ipAddress: req.meraAuth?.ipAddress || (req.header("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 64) || null,
    deviceInfo: req.header("user-agent")?.slice(0, 255) || null,
  })
  return ok(res, payload)
}

export async function me(req, res) {
  return ok(res, await authService.me(req.meraAuth))
}

export async function patchMe(req, res) {
  return ok(res, await authService.patchMe(req.meraAuth, req.body))
}

export async function changePassword(req, res) {
  return ok(res, await authService.changePassword(req.meraAuth, req.body))
}

export async function getMyPreferences(req, res) {
  return ok(res, await authService.getMyPreferences(req.meraAuth))
}

export async function patchMyPreferences(req, res) {
  return ok(res, await authService.patchMyPreferences(req.meraAuth, req.body))
}

export async function listSessions(req, res) {
  return ok(res, await authService.listSessions(req.meraAuth))
}

export async function revokeOtherSessions(req, res) {
  return ok(res, await authService.revokeOtherSessions(req.meraAuth))
}

export async function revokeSession(req, res) {
  return ok(res, await authService.revokeSession(req.meraAuth, req.params.publicId))
}

export async function verifyRole(req, res) {
  const requestedRoles = String(req.query.roles || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
  return ok(res, {
    authorized: authService.verifyAnyRole(req.meraAuth, requestedRoles),
    activeRole: req.meraAuth?.role || null,
  })
}

export async function logout(req, res) {
  await authService.logout(req.meraAuth)
  return ok(res, { loggedOut: true })
}

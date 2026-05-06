import { ok } from "../../../utils/http.js"
import * as authService from "../services/auth.service.js"
import { logMeraAudit } from "../services/audit.service.js"

export async function login(req, res) {
  const payload = await authService.login({ payload: req.body, req })
  await logMeraAudit({
    actorRole: payload?.user?.role || "UNKNOWN",
    actionType: "MERA_LOGIN",
    actionDescription: `MERA login for ${payload?.user?.email || "unknown user"}.`,
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

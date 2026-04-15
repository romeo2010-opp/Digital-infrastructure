import { ok } from "../../utils/http.js"
import {
  clearPasskeyChallengeCookie,
  clearRefreshCookie,
  getPasskeyChallengeCookie,
  setPasskeyChallengeCookie,
  setRefreshCookie,
} from "./auth.cookies.js"
import * as authService from "./auth.service.js"
import { resolveWebAuthnContext } from "./auth.passkeys.js"

export async function login(req, res) {
  const result = await authService.login({
    credentials: req.body,
    req,
  })

  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
  return ok(res, {
    accessToken: result.accessToken,
    user: result.user,
    station: result.station,
    role: result.role,
    stationMemberships: result.stationMemberships,
  })
}

export async function register(req, res) {
  const result = await authService.register({
    payload: req.body,
    req,
  })

  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
  return ok(res, {
    accessToken: result.accessToken,
    user: result.user,
    station: result.station,
    role: result.role,
    stationMemberships: result.stationMemberships,
    created: true,
  })
}

export async function beginPasskeyRegistration(req, res) {
  const data = await authService.beginPasskeyRegistration({
    auth: req.auth,
    req,
  })
  const context = resolveWebAuthnContext(req)
  setPasskeyChallengeCookie(
    res,
    "REGISTER",
    {
      challengeId: data?.challengeId || null,
      challenge: data?.publicKey?.challenge || null,
      origin: context.origin,
      rpId: context.rpId,
      userId: req.auth?.userId || null,
    },
    data?.expiresAt || new Date(Date.now() + 10 * 60 * 1000)
  )
  return ok(res, data)
}

export async function completePasskeyRegistration(req, res) {
  const data = await authService.completePasskeyRegistration({
    auth: req.auth,
    payload: req.body,
    cookieChallenge: getPasskeyChallengeCookie(req, "REGISTER"),
    req,
  })
  clearPasskeyChallengeCookie(res, "REGISTER")
  return ok(res, data)
}

export async function listPasskeys(req, res) {
  const data = await authService.listPasskeys({
    auth: req.auth,
  })
  return ok(res, data)
}

export async function beginPasskeyLogin(req, res) {
  const data = await authService.beginPasskeyLogin({ req })
  const context = resolveWebAuthnContext(req)
  setPasskeyChallengeCookie(
    res,
    "AUTHENTICATE",
    {
      challengeId: data?.challengeId || null,
      challenge: data?.publicKey?.challenge || null,
      origin: context.origin,
      rpId: context.rpId,
    },
    data?.expiresAt || new Date(Date.now() + 10 * 60 * 1000)
  )
  return ok(res, data)
}

export async function completePasskeyLogin(req, res) {
  const result = await authService.completePasskeyLogin({
    payload: req.body,
    cookieChallenge: getPasskeyChallengeCookie(req, "AUTHENTICATE"),
    req,
  })

  clearPasskeyChallengeCookie(res, "AUTHENTICATE")
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
  return ok(res, {
    accessToken: result.accessToken,
    user: result.user,
    station: result.station,
    role: result.role,
    stationMemberships: result.stationMemberships,
  })
}

export async function removePasskey(req, res) {
  const data = await authService.removePasskey({
    auth: req.auth,
    passkeyPublicId: req.params?.passkeyPublicId,
    req,
  })
  return ok(res, data)
}

export async function refresh(req, res) {
  const refreshToken = req.cookies?.sl_refresh
  const result = await authService.refresh({ refreshToken, req })
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
  return ok(res, { accessToken: result.accessToken })
}

export async function logout(req, res) {
  const refreshToken = req.cookies?.sl_refresh
  await authService.logout({ refreshToken, req })
  clearRefreshCookie(res)
  return ok(res, { loggedOut: true })
}

export async function me(req, res) {
  const data = await authService.me(req.auth)
  return ok(res, data)
}

export async function updateProfile(req, res) {
  const data = await authService.updateProfile({
    auth: req.auth,
    payload: req.body,
    req,
  })
  return ok(res, data)
}

export async function switchStation(req, res) {
  const result = await authService.switchStation({
    auth: req.auth,
    stationPublicId: req.body?.stationPublicId,
    refreshToken: req.cookies?.sl_refresh,
    req,
  })

  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
  return ok(res, {
    accessToken: result.accessToken,
    station: result.station,
    role: result.role,
    stationMemberships: result.stationMemberships,
  })
}

export async function changePassword(req, res) {
  const data = await authService.changePassword({
    auth: req.auth,
    payload: req.body,
    refreshToken: req.cookies?.sl_refresh,
    req,
  })
  return ok(res, data)
}

export async function listSessions(req, res) {
  const data = await authService.listSessions({
    auth: req.auth,
    refreshToken: req.cookies?.sl_refresh,
  })
  return ok(res, data)
}

export async function logoutApi(req, res) {
  const refreshToken = req.cookies?.sl_refresh
  await authService.logout({ refreshToken, req })
  clearRefreshCookie(res)
  return ok(res, { loggedOut: true })
}

export async function logoutOthers(req, res) {
  const data = await authService.logoutOthers({
    auth: req.auth,
    refreshToken: req.cookies?.sl_refresh,
    req,
  })
  return ok(res, data)
}

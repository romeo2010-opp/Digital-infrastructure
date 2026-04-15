function baseCookieOptions() {
  const secure = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true"
  const domain = process.env.COOKIE_DOMAIN || undefined
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/auth",
    ...(domain ? { domain } : {}),
  }
}

function passkeyChallengeCookieName(purpose) {
  return purpose === "REGISTER" ? "sl_passkey_register" : "sl_passkey_login"
}

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie("sl_refresh", token, {
    ...baseCookieOptions(),
    expires: expiresAt,
  })
}

export function clearRefreshCookie(res) {
  res.clearCookie("sl_refresh", {
    ...baseCookieOptions(),
  })
}

export function setPasskeyChallengeCookie(res, purpose, payload, expiresAt) {
  const encoded = Buffer.from(JSON.stringify(payload || {}), "utf8").toString("base64url")
  res.cookie(passkeyChallengeCookieName(purpose), encoded, {
    ...baseCookieOptions(),
    expires: expiresAt,
  })
}

export function getPasskeyChallengeCookie(req, purpose) {
  const raw = String(req?.cookies?.[passkeyChallengeCookieName(purpose)] || "").trim()
  if (!raw) return null

  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    return null
  }
}

export function clearPasskeyChallengeCookie(res, purpose) {
  res.clearCookie(passkeyChallengeCookieName(purpose), {
    ...baseCookieOptions(),
  })
}

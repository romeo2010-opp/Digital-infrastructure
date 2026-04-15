export function isApiKeyValid(req) {
  const expected = process.env.API_KEY
  const actual = req.header("x-api-key")
  return Boolean(expected && actual && actual === expected)
}

export function requireApiKey(req, res, next) {
  if (isApiKeyValid(req)) {
    return next()
  }

  return res.status(401).json({
    ok: false,
    error: "Unauthorized",
  })
}

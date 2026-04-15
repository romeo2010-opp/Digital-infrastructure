export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  })
}

export function errorHandler(err, req, res, _next) {
  if (err?.name === "ZodError") {
    return res.status(400).json({
      ok: false,
      error: "Validation failed",
      details: err.errors || [],
    })
  }

  const status = err.status || 500
  const message = err.message || "Internal Server Error"

  if (status >= 500) {
    const safeError = {
      name: err?.name || "Error",
      message: err?.message || "Unknown error",
      code: err?.code,
      stack: typeof err?.stack === "string" ? err.stack : undefined,
      path: req?.originalUrl,
      method: req?.method,
    }
    // eslint-disable-next-line no-console
    console.error("[ERROR]", safeError)
  }

  res.status(status).json({
    ok: false,
    error: message,
  })
}

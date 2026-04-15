function toJsonSafe(value) {
  if (typeof value === "bigint") {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (
    value &&
    typeof value === "object" &&
    (
      value?.constructor?.name === "Decimal" ||
      (
        typeof value?.toNumber === "function" &&
        typeof value?.toFixed === "function" &&
        Array.isArray(value?.d)
      )
    )
  ) {
    const numeric = Number(value.toString())
    return Number.isFinite(numeric) ? numeric : value.toString()
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafe)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)])
    )
  }

  return value
}

export function ok(res, data, status = 200) {
  return res.status(status).json({
    ok: true,
    data: toJsonSafe(data),
  })
}

export function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

export function unauthorized(message) {
  const error = new Error(message)
  error.status = 401
  return error
}

export function notFound(message) {
  const error = new Error(message)
  error.status = 404
  return error
}

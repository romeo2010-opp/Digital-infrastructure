export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message)
    this.status = status
    this.code = options.code || null
    this.details = options.details || null
    this.expose = options.expose ?? status < 500
    if (options.cause) this.cause = options.cause
  }
}

export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

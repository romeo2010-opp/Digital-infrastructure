export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

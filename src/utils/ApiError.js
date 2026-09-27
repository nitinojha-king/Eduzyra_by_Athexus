export class ApiError extends Error {
  constructor(statusCode, message, errorCode) {
    super(message)
    this.statusCode = statusCode
    // Optional machine-readable code (e.g. 'EMAIL_NOT_VERIFIED') so the
    // frontend can branch on something more stable than the message text.
    if (errorCode) this.errorCode = errorCode
  }
}

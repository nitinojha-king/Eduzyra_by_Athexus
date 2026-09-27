import { ApiError } from '../utils/ApiError.js'

export function notFound(req, res, next) {
  const error = new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`)
  next(error)
}

export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode && err.statusCode !== 200 ? err.statusCode : 500
  let message = err.message || 'Server error'

  // Mongoose duplicate key error (e.g. email already registered)
  if (err.code === 11000) {
    statusCode = 409
    const field = Object.keys(err.keyValue || {})[0]
    message = field ? `${field} already in use` : 'Duplicate value'
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ')
  }

  // Mongoose CastError (invalid ObjectId, etc.)
  if (err.name === 'CastError') {
    statusCode = 400
    message = `Invalid ${err.path}: ${err.value} is not a valid ${err.kind}`
  }

  // Multer errors (file upload limits)
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413
    message = 'File too large. Please upload a smaller file.'
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400
    message = 'Unexpected file field. Check the field name and try again.'
  } else if (err.message && err.message.includes('Only ') && err.message.includes('files are allowed')) {
    // Multer file filter rejection (image-only or PDF-only)
    statusCode = 400
  }

  res.status(statusCode).json({
    message,
    ...(err.errorCode ? { errorCode: err.errorCode } : {}),
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  })
}

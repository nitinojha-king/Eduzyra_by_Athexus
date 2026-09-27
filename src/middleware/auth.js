import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Not authorized — no token provided')
  }

  const token = header.split(' ')[1]

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    throw new ApiError(401, 'Not authorized — invalid or expired token')
  }

  // Select passwordChangedAt so we can check if the token was issued before
  // the most recent password change (invalidates stolen tokens on password reset)
  const user = await User.findById(decoded.id).select('+passwordChangedAt')
  if (!user) {
    throw new ApiError(401, 'Not authorized — user no longer exists')
  }

  // If the user changed their password after this JWT was issued, reject it
  if (user.passwordChangedAt) {
    const changedTimestamp = Math.floor(user.passwordChangedAt.getTime() / 1000)
    if (decoded.iat < changedTimestamp) {
      throw new ApiError(401, 'Session expired — please log in again')
    }
  }

  req.user = user
  next()
})

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden — insufficient role for this action'))
    }
    next()
  }
}

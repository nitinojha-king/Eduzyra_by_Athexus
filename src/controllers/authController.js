import crypto from 'crypto'
import User from '../models/User.js'
import Enrollment from '../models/Enrollment.js'
import Order from '../models/Order.js'
import Course from '../models/Course.js'
import { generateToken } from '../utils/generateToken.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { sendWelcomeEmail, sendPasswordResetEmail, sendOtpEmail } from '../services/emailService.js'
import { generateOtp, hashOtp, OTP_TTL_MINUTES, OTP_RESEND_COOLDOWN_SECONDS, OTP_MAX_ATTEMPTS } from '../utils/otp.js'

const devOtpCache = new Map()

function storeDevOtp(email, otp, expiresAt) {
  if (process.env.NODE_ENV === 'production') return
  const normalizedEmail = String(email || '').toLowerCase()
  if (!normalizedEmail) return
  devOtpCache.set(normalizedEmail, { otp, expiresAt })
  setTimeout(() => {
    const existing = devOtpCache.get(normalizedEmail)
    if (existing && existing.expiresAt.getTime() === expiresAt.getTime()) {
      devOtpCache.delete(normalizedEmail)
    }
  }, OTP_TTL_MINUTES * 60 * 1000 + 60 * 1000)
}

function clearDevOtp(email) {
  if (process.env.NODE_ENV === 'production') return
  const normalizedEmail = String(email || '').toLowerCase()
  if (!normalizedEmail) return
  devOtpCache.delete(normalizedEmail)
}

// Generates a fresh OTP, stamps it (hashed) on the user document, and emails
// the raw code. Caller is responsible for `await user.save()` beforehand if
// other fields changed, and for saving again after this returns (this only
// mutates the in-memory document — it does not persist on its own, so it can
// be composed with a single save() call by the caller).
async function issueOtp(user) {
  const otp = generateOtp()
  user.otpCode = hashOtp(otp)
  user.otpExpires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)
  user.otpAttempts = 0
  user.otpLastSentAt = new Date()
  await user.save()

  if (process.env.NODE_ENV !== 'production') {
    storeDevOtp(user.email, otp, user.otpExpires)
  }

  const otpSent = await sendOtpEmail({ name: user.name, email: user.email, otp, ttlMinutes: OTP_TTL_MINUTES })
  if (!otpSent) {
    console.warn('[issueOtp] OTP email delivery failed. Check SMTP configuration or review server logs for the OTP code in development.')
  }
}

// POST /api/auth/signup
//
// Signup no longer issues a login token directly. The account is created as
// unverified and a 6-digit OTP is emailed; the client must call
// POST /api/auth/verify-otp with that code before a token is granted. This
// keeps the rest of the app (enrollment, payments, etc.) working against
// verified accounts only, and cuts down on throwaway/typo'd email signups.
export const signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.validatedBody || req.body

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists')
  }

  const user = await User.create({ name, email, password, role: 'student', isVerified: false })
  await issueOtp(user)

  res.status(201).json({
    message: 'Account created. Enter the verification code sent to your email.',
    email: user.email,
    requiresOtp: true,
  })
})

// POST /api/auth/verify-otp
//
// Confirms the code emailed at signup (or resend-otp) and, on success,
// activates the account and returns a login token — mirroring what signup
// used to return directly.
export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.validatedBody || req.body

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+otpCode +otpExpires +otpAttempts',
  )
  if (!user) {
    throw new ApiError(400, 'Invalid or expired code')
  }

  // Already-verified accounts must log in with their password — never mint
  // a session from an OTP guess. (Previously this branch returned a token
  // without checking the code, so anyone knowing a verified email could get
  // access with any 6-digit code.)
  if (user.isVerified) {
    throw new ApiError(400, 'This account is already verified. Please log in instead.')
  }

  if (!user.otpCode || !user.otpExpires || user.otpExpires < new Date()) {
    throw new ApiError(400, 'This code has expired. Request a new one.', 'OTP_EXPIRED')
  }

  if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(429, 'Too many incorrect attempts. Request a new code.', 'OTP_LOCKED')
  }

  if (hashOtp(otp) !== user.otpCode) {
    user.otpAttempts += 1
    await user.save()
    throw new ApiError(400, 'Incorrect code. Please try again.', 'OTP_INVALID')
  }

  user.isVerified = true
  user.otpCode = undefined
  user.otpExpires = undefined
  user.otpAttempts = 0
  await user.save()
  clearDevOtp(user.email)

  try {
    await sendWelcomeEmail({ name: user.name, email: user.email })
  } catch (err) {
    console.error('[verifyOtp] Welcome email failed:', err?.message || err)
  }

  const token = generateToken(user)
  res.json({ user: user.toSafeObject(), token })
})

// POST /api/auth/resend-otp
//
// Response is intentionally identical whether or not the account exists /
// is already verified, to avoid leaking account state. A short cooldown
// (OTP_RESEND_COOLDOWN_SECONDS) prevents spamming the mailbox.
export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.validatedBody || req.body

  const user = await User.findOne({ email: email.toLowerCase() }).select('+otpLastSentAt')
  const genericMessage = { message: 'If that account needs verification, a new code has been sent.' }

  if (!user || user.isVerified) {
    return res.json(genericMessage)
  }

  if (user.otpLastSentAt) {
    const secondsSinceLast = (Date.now() - user.otpLastSentAt.getTime()) / 1000
    if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)
      throw new ApiError(429, `Please wait ${waitSeconds}s before requesting another code.`, 'OTP_COOLDOWN')
    }
  }

  await issueOtp(user)
  res.json(genericMessage)
})

export const getDevOtp = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new ApiError(404, 'Not found')
  }

  const email = String(req.query.email || '').trim().toLowerCase()
  if (!email) {
    throw new ApiError(400, 'email query parameter is required')
  }

  const cached = devOtpCache.get(email)
  if (!cached || !cached.otp || !cached.expiresAt || cached.expiresAt < new Date()) {
    throw new ApiError(404, 'No valid development OTP found for this account')
  }

  res.json({ email, otp: cached.otp, expiresAt: cached.expiresAt })
})

// POST /api/auth/login
// Account lockout (Phase 7): after 5 failed attempts, the account is locked
// for 15 minutes. The error message is intentionally generic ("Invalid email
// or password") so attackers can't tell whether the account exists or is
// locked. On successful login, loginAttempts is reset and lockUntil cleared.
const MAX_LOGIN_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validatedBody || req.body

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password +loginAttempts +lockUntil')
  if (!user) {
    throw new ApiError(401, 'Invalid email or password')
  }

  // Check if the account is currently locked
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new ApiError(429, 'Account temporarily locked. Try again in 15 minutes.')
  }

  // If lockUntil has passed, reset the counter (the lock has expired)
  if (user.lockUntil && user.lockUntil <= new Date()) {
    user.loginAttempts = 0
    user.lockUntil = undefined
  }

  const isMatch = await user.comparePassword(password)

  if (!isMatch) {
    // Increment failed attempts
    user.loginAttempts = (user.loginAttempts || 0) + 1

    // Lock the account if threshold reached
    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS)
    }

    await user.save()
    // Generic error — never reveal that the account is about to lock
    throw new ApiError(401, 'Invalid email or password')
  }

  // Success — reset lockout counters
  if (user.loginAttempts > 0 || user.lockUntil) {
    user.loginAttempts = 0
    user.lockUntil = undefined
    await user.save()
  }

  // Credentials are correct, but the account's email is unverified — block
  // the session and point the client at the OTP flow instead of the generic
  // "Invalid email or password" message (the identity IS confirmed here, so
  // there's no enumeration risk in saying so).
  if (!user.isVerified) {
    throw new ApiError(403, 'Please verify your email before logging in.', 'EMAIL_NOT_VERIFIED')
  }

  const token = generateToken(user)
  res.json({ user: user.toSafeObject(), token })
})

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeObject() })
})

// POST /api/auth/forgot-password
//
// Security: This endpoint NEVER returns the raw reset token to the client.
// The token is only stored on the User document as a SHA-256 hash
// (resetPasswordToken) and is intended to be delivered to the user via a
// secure out-of-band channel (email). The email service is not yet wired
// up — until it is, password reset cannot be completed end-to-end. The
// response is intentionally identical whether or not the email exists, to
// prevent account enumeration.
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.validatedBody || req.body

  const user = await User.findOne({ email: email.toLowerCase() })

  if (!user) {
    return res.json({ message: 'If that account exists, a reset link has been generated.' })
  }

  const rawToken = crypto.randomBytes(32).toString('hex')
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex')
  const ttlMinutes = Number(process.env.RESET_TOKEN_TTL_MINUTES || 30)
  user.resetPasswordExpires = new Date(Date.now() + ttlMinutes * 60 * 1000)
  await user.save()

  // ⚠️  The raw token is intentionally NOT included in the response.
  //     It must only be delivered via email (to be wired up separately).
  //     Returning it here would allow anyone who knows a user's email to
  //     take over their account (full account takeover vulnerability).
  //
  // Email delivery: send the reset link via emailService. If SMTP is not
  // configured, fall back to a dev-only console.warn so the developer can
  // still test the reset flow end-to-end. This is the ONLY place the raw
  // token may appear in any output — never in an HTTP response.
  const resetUrl = `${process.env.CLIENT_ORIGIN}/reset-password?token=${rawToken}`
  try {
    await sendPasswordResetEmail({ name: user.name, email: user.email, resetUrl })
  } catch (err) {
    // sendPasswordResetEmail already logs internally; this catch is a safety net.
    console.error('[forgotPassword] sendPasswordResetEmail threw:', err?.message || err)
  }

  // Dev fallback: if SMTP wasn't configured (sendPasswordResetEmail failed
  // silently), log the reset URL so the developer can test.
  if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST) {
    console.warn('[forgotPassword] SMTP not configured — reset link not sent. Token expires in', ttlMinutes, 'min.')
    console.warn('[forgotPassword] DEBUG reset URL:', resetUrl)
  }

  res.json({ message: 'If that account exists, a reset link has been generated.' })
})

// POST /api/auth/reset-password
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.validatedBody || req.body

  const hashed = crypto.createHash('sha256').update(token).digest('hex')
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires')

  if (!user) {
    throw new ApiError(400, 'Reset token is invalid or has expired')
  }

  user.password = password
  user.resetPasswordToken = undefined
  user.resetPasswordExpires = undefined
  await user.save()

  res.json({ message: 'Password has been reset. You can now log in.' })
})

// PATCH /api/auth/me
export const updateProfile = asyncHandler(async (req, res) => {
  const { name, email, currentPassword, newPassword } = req.validatedBody || req.body

  if (name !== undefined) req.user.name = name
  if (email !== undefined) {
    const existing = await User.findOne({ email: email.toLowerCase() })
    if (existing && !existing._id.equals(req.user._id)) {
      throw new ApiError(409, 'An account with this email already exists')
    }
    req.user.email = email
  }

  if (newPassword) {
    const userWithPassword = await User.findById(req.user._id).select('+password')
    const ok = await userWithPassword.comparePassword(currentPassword)
    if (!ok) throw new ApiError(401, 'Current password is incorrect')
    req.user.password = newPassword
  }

  await req.user.save()
  res.json({ user: req.user.toSafeObject() })
})

// POST /api/auth/logout
export const logout = asyncHandler(async (req, res) => {
  res.json({ message: 'Logged out' })
})

// GET /api/auth/users — admin: list all users with enrollment count (fixed N+1)
export const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ role: 'student' }).sort({ createdAt: -1 }).lean()
  const counts = await Enrollment.aggregate([
    { $group: { _id: '$student', count: { $sum: 1 } } },
  ])
  const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]))

  const rows = users.map((u) => ({
    id: u._id,
    name: u.name,
    email: u.email,
    enrolledCourses: countMap[String(u._id)] || 0,
    joined: u.createdAt.toISOString().slice(0, 10),
  }))
  res.json(rows)
})

// GET /api/auth/stats — admin: aggregated dashboard stats (fixed memory issue)
export const getStats = asyncHandler(async (req, res) => {
  const [totalStudents, liveCourses, aggregation] = await Promise.all([
    User.countDocuments({ role: 'student' }),
    Course.countDocuments({ status: 'published' }),
    Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' },
        },
      },
    ]),
  ])

  const statsFromAgg = Object.fromEntries(aggregation.map((a) => [a._id, a]))

  res.json({
    totalRevenue: statsFromAgg.paid?.total || 0,
    totalStudents,
    liveCourses,
    successfulPayments: statsFromAgg.paid?.count || 0,
    pendingPayments: statsFromAgg.pending?.count || 0,
    failedPayments: statsFromAgg.failed?.count || 0,
    refunds: statsFromAgg.refunded?.count || 0,
  })
})

// PATCH /api/auth/me/avatar — upload user avatar (protected)
// Multer parses the file into req.file.buffer (memory storage). We compress
// with Sharp to 400x400 WebP, upload to Cloudinary, and store the URL on
// the User. If the user already has an avatar, delete the old Cloudinary
// asset before uploading the new one.
export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded. Field name must be "avatar".')
  }

  // Lazy-import Sharp so the app can boot without Sharp installed in dev
  const sharp = (await import('sharp')).default

  // Compress: 400x400 max, WebP, quality 80
  const compressedBuffer = await sharp(req.file.buffer)
    .resize(400, 400, { fit: 'cover', position: 'center' })
    .webp({ quality: 80 })
    .toBuffer()

  // Lazy-import the Cloudinary helper
  const { uploadToCloudinary, deleteFromCloudinary } = await import('../config/cloudinary.js')

  // Delete old avatar if it exists
  if (req.user.avatarPublicId) {
    await deleteFromCloudinary(req.user.avatarPublicId)
  }

  // Upload new avatar
  const result = await uploadToCloudinary(compressedBuffer, {
    folder: 'eduzyra/avatars',
    resource_type: 'image',
  })

  // Update user
  req.user.avatar = result.secure_url
  req.user.avatarPublicId = result.public_id
  await req.user.save()

  res.json({ user: req.user.toSafeObject() })
})

// POST /api/auth/contact — public (no auth), sends a contact form email
export const contactForm = asyncHandler(async (req, res) => {
  const { name, email, message } = req.body
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    throw new ApiError(400, 'Name, email, and message are required')
  }

  try {
    const { sendContactEmail } = await import('../services/emailService.js')
    await sendContactEmail({ name: name.trim(), email: email.trim(), message: message.trim() })
  } catch (err) {
    console.error('[contactForm] email send failed:', err?.message || err)
    // Don't fail the request — still show success to prevent email enumeration
  }

  res.json({ message: 'Message received. We will get back to you shortly.' })
})

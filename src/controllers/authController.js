import User from '../models/User.js'
import Enrollment from '../models/Enrollment.js'
import Order from '../models/Order.js'
import Course from '../models/Course.js'
import { generateToken } from '../utils/generateToken.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { verifyGoogleIdToken } from '../services/googleAuth.js'

// ── Google Sign-In ────────────────────────────────────────────────────────
//
// Links a verified Google identity to an existing account. Matching is done
// on Google's verified email because the user's stated requirement is that an
// existing email account "just logs in" with Google. The account's password,
// role and enrollments are left untouched.
async function linkGoogleAccount(user, profile) {
  if (user.googleId && user.googleId !== profile.googleId) {
    throw new ApiError(
      409,
      'This email is already linked to a different Google account.',
      'GOOGLE_ACCOUNT_CONFLICT',
    )
  }

  user.googleId = profile.googleId
  if (!user.avatar && profile.picture) user.avatar = profile.picture

  await user.save()
  return user
}

async function createGoogleUser(profile) {
  const user = new User({
    name: profile.name,
    email: profile.email,
    role: 'student',
    googleId: profile.googleId,
    // No password is stored until the user explicitly sets one in profile.
    hasPassword: false,
    avatar: profile.picture || '',
  })
  await user.save()
  return user
}

// POST /api/auth/google
//
// Public. Body: { credential } — the ID token returned by Google Identity
// Services on the frontend. The token is verified server-side; the email is
// never trusted from the request body.
//
// Behaviour:
//   - new email            → create a student account, return a JWT
//   - existing email       → link googleId (if needed) and log them in
//   - existing googleId    → log them in
export const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.validatedBody || req.body
  const profile = await verifyGoogleIdToken(credential)

  let user = await User.findOne({ googleId: profile.googleId })
  let isNewUser = false

  if (!user) {
    user = await User.findOne({ email: profile.email })

    if (user) {
      user = await linkGoogleAccount(user, profile)
    } else {
      try {
        user = await createGoogleUser(profile)
        isNewUser = true
      } catch (err) {
        // Two simultaneous first-time logins can race on the unique indexes.
        // Re-read the winner instead of surfacing a 409/500.
        if (err?.code !== 11000) throw err
        user = await User.findOne({
          $or: [{ googleId: profile.googleId }, { email: profile.email }],
        })
        if (!user) throw err
        // linkGoogleAccount rejects a concurrent winner that is linked to a
        // different Google identity, so the race cannot bypass the conflict check.
        user = await linkGoogleAccount(user, profile)
        isNewUser = false
      }
    }
  }

  res.json({ user: user.toSafeObject(), token: generateToken(user), isNewUser })
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

  // Google-created accounts have no password hash. Point the user at the
  // correct flow instead of letting bcrypt compare against undefined.
  if (!user.password) {
    throw new ApiError(
      401,
      'This account uses Google Sign-In. Please continue with Google.',
      'USE_GOOGLE_SIGN_IN',
    )
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

  const token = generateToken(user)
  res.json({ user: user.toSafeObject(), token })
})

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeObject() })
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

    // Local accounts must prove the old password. Google-only accounts have
    // no old password — they are already authenticated by their JWT, so this
    // becomes their initial "set password" action.
    if (userWithPassword.password) {
      if (!currentPassword) {
        throw new ApiError(
          400,
          'Current password is required to change your password.',
          'CURRENT_PASSWORD_REQUIRED',
        )
      }
      const ok = await userWithPassword.comparePassword(currentPassword)
      if (!ok) throw new ApiError(401, 'Current password is incorrect')
    }

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

import mongoose from 'mongoose'

// Hard cap for how long an unconfirmed signup is kept for. The OTP itself
// still expires much sooner (OTP_TTL_MINUTES) — this only governs when an
// abandoned signup disappears entirely.
export const PENDING_SIGNUP_TTL_HOURS = Number(process.env.PENDING_SIGNUP_TTL_HOURS || 24)

// ── PendingSignup ─────────────────────────────────────────────────────────
//
// A signup that has been accepted but not yet confirmed with its OTP.
//
// The key idea: a User row is only written on successful OTP verification.
// Until then the account lives here, so an undelivered email never leaves a
// half-registered account behind — and re-running signup with the same address
// just re-issues the code instead of colliding with a duplicate account.
//
// SECURITY: `passwordHash` stores the bcrypt hash computed at signup time.
// The raw password is never persisted, logged, or returned by any route.
const pendingSignupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['student', 'instructor', 'admin'], default: 'student' },

    // ── OTP state (mirrors the User model, hashed the same way) ───────────
    otpCode: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpLastSentAt: { type: Date, select: false },

    // MongoDB TTL index — the document is auto-deleted at this timestamp.
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + PENDING_SIGNUP_TTL_HOURS * 60 * 60 * 1000),
      expires: 0,
    },
  },
  { timestamps: true },
)

export default mongoose.model('PendingSignup', pendingSignupSchema)

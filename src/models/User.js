import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export const ROLES = ['student', 'instructor', 'admin']

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ROLES, default: 'student' },
    enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    // ── Email OTP verification ──────────────────────────────────────────────
    // New signups start unverified; login is blocked until the OTP emailed
    // at signup is confirmed via POST /api/auth/verify-otp. Only the SHA-256
    // hash of the OTP is stored — the raw code only ever appears in the email.
    isVerified: { type: Boolean, default: false },
    otpCode: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpLastSentAt: { type: Date, select: false },
    // ── Account lockout (Phase 7) ──────────────────────────────────────────
    loginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    // ── JWT invalidation on password change ────────────────────────────────
    passwordChangedAt: { type: Date, select: false },
    // ── Cloudinary avatar ──────────────────────────────────────────────────
    avatar: { type: String, default: '' },           // Cloudinary secure URL
    avatarPublicId: { type: String, default: '' },   // For deletion on replace
  },
  { timestamps: true },
)

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next()
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
  // Stamp passwordChangedAt so protect middleware can reject old JWTs
  this.passwordChangedAt = new Date()
  next()
})

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password)
}

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    enrolledCourses: this.enrolledCourses,
    isVerified: this.isVerified,
    avatar: this.avatar || '',
    createdAt: this.createdAt,
  }
}

export default mongoose.model('User', userSchema)

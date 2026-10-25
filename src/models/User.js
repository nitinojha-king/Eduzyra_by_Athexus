import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export const ROLES = ['student', 'instructor', 'admin']

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Optional: accounts created through Google Sign-In have no password until
    // the user chooses to set one. Existing password accounts still log in.
    password: { type: String, required: false, minlength: 6, select: false },
    // Google's stable subject identifier (`sub`). Sparse + unique so any
    // number of password-only accounts can omit it.
    googleId: { type: String, unique: true, sparse: true, trim: true },
    // Whether the account can authenticate with a password. Kept as a real
    // field (password is select:false) so toSafeObject can report it without
    // loading the bcrypt hash.
    hasPassword: { type: Boolean, default: true },
    role: { type: String, enum: ROLES, default: 'student' },
    enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
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
  // Set `$locals.bypassPasswordHash` when the password field already holds a
  // bcrypt hash — re-hashing it would make the account impossible to log into.
  if (this.$locals?.bypassPasswordHash) {
    if (this.password) this.hasPassword = true
    return next()
  }
  if (!this.isModified('password')) return next()
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
  // Stamp passwordChangedAt so protect middleware can reject old JWTs
  this.passwordChangedAt = new Date()
  if (this.password) this.hasPassword = true
  next()
})

userSchema.methods.comparePassword = function comparePassword(candidate) {
  // Google-only accounts have no stored hash; never let bcrypt throw on it.
  if (!this.password) return Promise.resolve(false)
  return bcrypt.compare(candidate, this.password)
}

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    enrolledCourses: this.enrolledCourses,
    avatar: this.avatar || '',
    googleLinked: Boolean(this.googleId),
    hasPassword: this.hasPassword !== false,
    createdAt: this.createdAt,
  }
}

export default mongoose.model('User', userSchema)

import crypto from 'crypto'

// ── OTP helpers ──────────────────────────────────────────────────────────
// 6-digit numeric codes. Only the SHA-256 hash is ever persisted — the raw
// code is returned once (to be emailed) and never stored or logged.

/** Generate a random 6-digit numeric OTP as a string, e.g. "042817". */
export function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** Hash an OTP the same way a reset token is hashed, for storage/comparison. */
export function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

export const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10)
export const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 45)
export const OTP_MAX_ATTEMPTS = 5

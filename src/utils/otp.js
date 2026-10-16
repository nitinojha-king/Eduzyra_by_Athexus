import crypto from 'crypto'

// ── OTP helpers ──────────────────────────────────────────────────────────
// 6-digit numeric codes. Only the SHA-256 hash is ever persisted — the raw
// code is returned once (to be emailed) and never stored or logged.
//
// Config is read dynamically via getters (not import-time constants) so
// dotenv / test harnesses can set env vars before the values are needed.

/** Generate a random 6-digit numeric OTP as a string, e.g. "042817". */
export function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** Hash an OTP the same way a reset token is hashed, for storage/comparison. */
export function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex')
}

/** Minutes an OTP stays valid. Env: OTP_TTL_MINUTES (default 10). */
export function getOtpTtlMinutes() {
  const v = Number(process.env.OTP_TTL_MINUTES)
  return Number.isFinite(v) && v > 0 ? v : 10
}

/** Minimum seconds between two OTP mails. Env: OTP_RESEND_COOLDOWN_SECONDS (default 45). */
export function getOtpCooldownSeconds() {
  const v = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS)
  return Number.isFinite(v) && v >= 0 ? v : 45
}

/** Wrong-code attempts allowed before lockout. Env: OTP_MAX_ATTEMPTS (default 5). */
export function getOtpMaxAttempts() {
  const v = Number(process.env.OTP_MAX_ATTEMPTS)
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5
}

// Backwards-compatible static exports (evaluated once at import).
// Prefer the getters above — these exist so older imports keep working.
export const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES) > 0 ? Number(process.env.OTP_TTL_MINUTES) : 10
export const OTP_RESEND_COOLDOWN_SECONDS =
  Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) >= 0 ? Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) : 45
export const OTP_MAX_ATTEMPTS =
  Number(process.env.OTP_MAX_ATTEMPTS) > 0 ? Math.floor(Number(process.env.OTP_MAX_ATTEMPTS)) : 5

import { OAuth2Client } from 'google-auth-library'
import { ApiError } from '../utils/ApiError.js'

// Google Sign-In uses the ID-token flow: the React app obtains a signed
// credential from Google Identity Services and posts it to the backend. The
// backend verifies the signature, audience, issuer and expiry locally against
// Google's published keys — no client secret and no redirect URLs are needed.

let mockVerifier = null

/** Test hook: replace Google's token verification with a local function. */
export function setMockGoogleVerifier(fn) {
  mockVerifier = typeof fn === 'function' ? fn : null
}

export function resetMockGoogleVerifier() {
  mockVerifier = null
}

/** Accepts one client ID or a comma-separated list (web / iOS / Android). */
function getGoogleClientIds() {
  const raw = String(process.env.GOOGLE_CLIENT_ID || '').trim()
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    throw new ApiError(
      503,
      'Google Sign-In is not configured on the server. Set GOOGLE_CLIENT_ID.',
      'GOOGLE_NOT_CONFIGURED',
    )
  }
  return ids
}

/** Optional allowlist: GOOGLE_ALLOWED_DOMAINS=gmail.com,yourdomain.com */
function getAllowedDomains() {
  return String(process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function safePicture(picture) {
  return typeof picture === 'string' && /^https?:\/\//i.test(picture) ? picture : ''
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Verifies a Google ID token and returns the trusted profile fields.
 *
 * @param {string} credential Raw ID token / credential from Google Identity Services.
 * @returns {Promise<{googleId: string, email: string, name: string, picture: string}>}
 */
export async function verifyGoogleIdToken(credential) {
  if (typeof credential !== 'string' || !credential.trim()) {
    throw new ApiError(400, 'Google credential is required', 'GOOGLE_CREDENTIAL_REQUIRED')
  }

  let payload
  try {
    if (mockVerifier) {
      payload = await mockVerifier(credential.trim())
    } else {
      const audiences = getGoogleClientIds()
      const client = new OAuth2Client()
      const ticket = await client.verifyIdToken({
        idToken: credential.trim(),
        audience: audiences,
      })
      payload = ticket.getPayload()
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(401, 'Invalid Google credential', 'INVALID_GOOGLE_TOKEN')
  }

  if (!payload?.sub || !payload?.email) {
    throw new ApiError(401, 'Invalid Google credential', 'INVALID_GOOGLE_TOKEN')
  }

  // Only verified Google emails may create or link an account. This is the
  // security boundary that lets us trust the email for account matching.
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  if (!emailVerified) {
    throw new ApiError(
      403,
      'Your Google account email is not verified. Verify it with Google and try again.',
      'GOOGLE_EMAIL_NOT_VERIFIED',
    )
  }

  const email = String(payload.email).trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    throw new ApiError(401, 'Invalid Google credential', 'INVALID_GOOGLE_TOKEN')
  }

  const allowedDomains = getAllowedDomains()
  if (allowedDomains.length > 0) {
    const domain = email.split('@')[1]
    if (!allowedDomains.includes(domain)) {
      throw new ApiError(
        403,
        'Google Sign-In is not available for this email domain.',
        'GOOGLE_DOMAIN_NOT_ALLOWED',
      )
    }
  }

  const name = String(payload.name || '').trim() || email.split('@')[0]

  return {
    googleId: String(payload.sub),
    email,
    name,
    picture: safePicture(payload.picture),
  }
}

/**
 * emailService — centralised outbound email for Eduzyra.
 *
 * Provider: Brevo (formerly Sendinblue) Transactional Email REST API.
 * Endpoint: POST https://api.brevo.com/v3/smtp/email
 *
 * Why REST API instead of SMTP:
 * Cloud platforms (such as Render) commonly throttle or block outbound SMTP
 * ports (587, 465, 25), causing intermittent timeouts and connection drops.
 * Brevo's REST API operates over standard HTTPS (port 443) with a strict
 * 10-second timeout, ensuring maximum deliverability and resilience.
 *
  * Required Environment Variables:
  * - BREVO_API_KEY: Brevo v3 API key (starts with xkeysib-), from
  *   https://app.brevo.com/settings/keys/api
  * - EMAIL_FROM_NAME: Display name (e.g. "Eduzyra")
  * - EMAIL_FROM_ADDRESS: Sender email VERIFIED in Brevo (https://app.brevo.com/senders).
  *   Unverified senders are rejected by Brevo with HTTP 400.
 *
 * Error Handling:
 * Every email function wraps the send in try/catch and logs failures via
 * console.error. Email failures NEVER throw — a failed welcome email must
 * not fail the signup response.
 *
 * Security:
 * All user-supplied values (name, email, message, courseTitle) are
 * HTML-escaped via escapeHtml() before interpolation into email templates.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'
const BREVO_ACCOUNT_URL = 'https://api.brevo.com/v3/account'
const REQUEST_TIMEOUT_MS = 10000 // 10-second timeout requirement

// ── HTML escaping helper ──────────────────────────────────────────────────
// Escapes &, <, >, ", ' to prevent HTML injection in email templates.
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ── Mock sender testing hook ──────────────────────────────────────────────
let _mockSender = null

/**
 * Sets a custom mock email sender (used for hermetic offline tests).
 * @param {Function|null} senderFn
 */
export function setMockSender(senderFn) {
  _mockSender = senderFn
}

export function resetMockSender() {
  _mockSender = null
}

/**
 * Backwards-compatibility helper for tests or modules expecting setTransporter.
 * @param {object|Function|null} mock
 */
export function setTransporter(mock) {
  if (!mock) {
    _mockSender = null
    return
  }
  if (typeof mock === 'function') {
    _mockSender = mock
  } else if (typeof mock.sendMail === 'function') {
    _mockSender = async ({ to, subject, html, from }) => {
      return mock.sendMail({ from, to, subject, html })
    }
  }
}

export function resetTransporter() {
  _mockSender = null
}

export function resetBrevoClient() {
  _mockSender = null
}

// ── Configuration helpers ─────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function getSender() {
  const name = (process.env.EMAIL_FROM_NAME || 'Eduzyra').trim()
  // BREVO_SENDER_EMAIL is a legacy alias — EMAIL_FROM_ADDRESS is canonical.
  const email = (process.env.EMAIL_FROM_ADDRESS || process.env.BREVO_SENDER_EMAIL || '').trim()

  if (!email) {
    // No sender configured. Fall back so dev/test can boot, but warn loudly —
    // Brevo will reject this placeholder sender until a verified one is set.
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[emailService] EMAIL_FROM_ADDRESS is not set — using placeholder "contact@eduzyra.com". ' +
          'Set EMAIL_FROM_ADDRESS to a sender verified in Brevo (Senders & IP) or OTP/welcome emails will fail.',
      )
    }
    return { name, email: 'contact@eduzyra.com' }
  }

  if (!EMAIL_RE.test(email) && process.env.NODE_ENV !== 'test') {
    console.warn(`[emailService] EMAIL_FROM_ADDRESS "${email}" does not look like a valid email address.`)
  }
  return { name, email }
}

export function fromAddress() {
  const sender = getSender()
  // Email headers must NOT be HTML-escaped — only strip characters that would
  // break the header (quotes / newlines). HTML-escaping belongs in the body.
  const safeName = sender.name.replace(/["\r\n]/g, '').trim() || 'Eduzyra'
  return `"${safeName}" <${sender.email}>`
}

export function getBrevoConfig() {
  const apiKey = (process.env.BREVO_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('Brevo not configured — set BREVO_API_KEY in .env (get one at https://app.brevo.com/settings/keys/api)')
  }
  if (!apiKey.startsWith('xkeysib-')) {
    console.warn('[emailService] BREVO_API_KEY does not start with "xkeysib-" — it may be invalid or revoked.')
  }
  const sender = getSender()
  if (!EMAIL_RE.test(sender.email)) {
    throw new Error(
      `Brevo sender misconfigured — EMAIL_FROM_ADDRESS "${sender.email}" is not a valid email. ` +
        'Set it to a sender verified in Brevo (https://app.brevo.com/senders).',
    )
  }
  return { apiKey, sender }
}

/**
 * Backwards-compatible facade for code referencing getTransporter().
 */
export function getTransporter({ reload = false } = {}) {
  if (reload) {
    resetTransporter()
  }
  const config = getBrevoConfig()
  return {
    options: {
      auth: { user: config.sender.email, pass: config.apiKey },
      apiKey: config.apiKey,
      service: 'brevo',
      connectionTimeout: REQUEST_TIMEOUT_MS,
    },
    verify: verifyBrevoConnection,
  }
}

/**
 * Verifies Brevo API key validity and account status.
 * @returns {Promise<{success: boolean, error?: string, account?: object}>}
 */
export async function verifyBrevoConnection() {
  try {
    const { apiKey } = getBrevoConfig()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Brevo verification timed out after ${REQUEST_TIMEOUT_MS}ms`))
    }, REQUEST_TIMEOUT_MS)

    let response
    try {
      response = await fetch(BREVO_ACCOUNT_URL, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const msg = errBody?.message || response.statusText || `HTTP ${response.status}`
      return {
        success: false,
        error: mapBrevoError(response.status, msg),
      }
    }

    const account = await response.json()
    return {
      success: true,
      account: {
        email: account.email,
        companyName: account.companyName,
        plan: account.plan,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err?.message || String(err),
    }
  }
}

export const verifySmtpConnection = verifyBrevoConnection

// ── Helpers ───────────────────────────────────────────────────────────────

/** Format paise (integer) as Indian Rupee string: 49900 → "₹499" */
function formatRupees(paise) {
  const rupees = Math.round(Number(paise) || 0) / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees)
}

/** Common HTML wrapper with Eduzyra branding — header, content, footer. */
function emailWrapper(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a202c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);max-width:600px;">
          <tr>
            <td style="background-color:#12213B;padding:24px 32px;text-align:center;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Eduzyra</span>
              <span style="font-size:11px;color:#529286;margin-left:8px;">by Althexus</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
                You're receiving this email because you have an Eduzyra account.<br>
                If this wasn't you, please reply to this email to let us know.<br>
                <strong>Eduzyra by Althexus</strong> &middot; India
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Map a Brevo API failure to a clear, actionable message. */
function mapBrevoError(status, rawMessage) {
  const msg = rawMessage || `HTTP ${status}`
  if (status === 401) {
    return `Brevo authentication failed (401): invalid or revoked API key. Regenerate it at https://app.brevo.com/settings/keys/api. Details: ${msg}`
  }
  if (status === 400) {
    return (
      `Brevo rejected the request (400): this usually means the sender address is not verified ` +
      `in Brevo (check https://app.brevo.com/senders) or a field is malformed. Details: ${msg}`
    )
  }
  if (status === 402) {
    return `Brevo quota exceeded (402): email credits exhausted. Check your Brevo plan. Details: ${msg}`
  }
  if (status === 429) {
    return `Brevo rate limit hit (429): too many emails too fast — the request was throttled. Details: ${msg}`
  }
  return `Brevo API error (${status}): ${msg}`
}

/** Strip HTML tags to produce a plain-text fallback for deliverability. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|div|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Centralised send — dispatches via Brevo REST API with 10s timeout, logs failures. */
async function send({ to, subject, html }) {
  try {
    if (!to || !EMAIL_RE.test(String(to).trim())) {
      throw new Error(`Invalid recipient email address: "${to}"`)
    }
    const recipient = String(to).trim()
    const sender = getSender()
    const formattedFrom = fromAddress()

    // Offline testing hook for hermetic unit/integration tests
    if (_mockSender) {
      await _mockSender({
        to: recipient,
        subject,
        html,
        text: htmlToText(html),
        from: formattedFrom,
        sender,
      })
      return true
    }

    const { apiKey } = getBrevoConfig()

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Brevo API request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    }, REQUEST_TIMEOUT_MS)

    let response
    try {
      response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [{ email: recipient }],
          subject,
          htmlContent: html,
          textContent: htmlToText(html),
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const raw = errBody?.message || response.statusText || `HTTP ${response.status}`
      throw new Error(mapBrevoError(response.status, raw))
    }

    return true
  } catch (err) {
    const errorMessage = err?.message || String(err)
    const isMissingConfig = errorMessage.includes('Brevo not configured') || errorMessage.includes('sender misconfigured')

    if (isMissingConfig && process.env.NODE_ENV === 'test') {
      return true
    }

    if (isMissingConfig && process.env.NODE_ENV !== 'production') {
      console.warn('[emailService] Brevo not configured. Dev fallback: email content logged to console.')
      console.group('[emailService] DEV EMAIL OUTPUT')
      console.log('to:', to)
      console.log('subject:', subject)
      console.log('html:', html)
      console.groupEnd()
      return false
    }

    console.error('[emailService] Failed to send email:', {
      to,
      subject,
      error: errorMessage,
    })
    return false
  }
}

// ── Public email functions ────────────────────────────────────────────────

/**
 * Welcome email — sent on signup.
 * @param {{name: string, email: string}} args
 */
export async function sendWelcomeEmail({ name, email }) {
  const html = emailWrapper(
    'Welcome to Eduzyra',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Welcome, ${escapeHtml(name)}!</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Your Eduzyra account is ready. You can now browse courses, enroll, and start learning today.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/courses" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Browse Courses</a>
     </p>
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       Happy learning!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: 'Welcome to Eduzyra', html })
}

/**
 * OTP verification email — sent on signup and on resend-otp.
 * @param {{name: string, email: string, otp: string, ttlMinutes: number}} args
 */
export async function sendOtpEmail({ name, email, otp, ttlMinutes }) {
  const html = emailWrapper(
    'Verify your Eduzyra account',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Verify your email</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, use the code below to verify your Eduzyra account and finish signing in.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <span style="display:inline-block;background-color:#EEF1F6;color:#12213B;padding:16px 32px;border-radius:8px;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:8px;border:2px dashed #529286;">${escapeHtml(otp)}</span>
     </p>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       This code expires in ${escapeHtml(String(ttlMinutes))} minutes. If you didn't create an Eduzyra account, you can safely ignore this email.
     </p>`,
  )
  return send({ to: email, subject: `${otp} is your Eduzyra verification code`, html })
}

/**
 * Password reset email — sent on forgotPassword.
 * @param {{name: string, email: string, resetUrl: string, ttlMinutes?: number}} args
 */
export async function sendPasswordResetEmail({ name, email, resetUrl, ttlMinutes = 30 }) {
  const html = emailWrapper(
    'Reset your Eduzyra password',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Reset your password</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, we received a request to reset your Eduzyra password. Click the button below to set a new one.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${resetUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Reset Password</a>
     </p>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       This link expires in ${escapeHtml(String(ttlMinutes))} minutes. If you didn't request this, you can safely ignore this email.
     </p>
     <p style="margin:16px 0 0;font-size:12px;color:#a0aec0;word-break:break-all;">
       Or copy this link: ${resetUrl}
     </p>`,
  )
  return send({ to: email, subject: 'Reset your Eduzyra password', html })
}

/**
 * Enrollment confirmation email — sent after successful enrollment.
 * @param {{name: string, email: string, courseTitle: string, courseUrl: string}} args
 */
export async function sendEnrollmentConfirmationEmail({ name, email, courseTitle, courseUrl }) {
  const html = emailWrapper(
    "You're enrolled!",
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">You're enrolled!</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, you're now enrolled in <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong>. Start learning right away.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${courseUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Start Learning</a>
     </p>
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       Happy learning!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Enrolled: ${escapeHtml(courseTitle)}`, html })
}

/**
 * Payment success email — sent after payment verification.
 * @param {{name: string, email: string, courseTitle: string, amount: number, transactionId: string, receiptUrl: string}} args
 *   amount is in PAISE — divided by 100 for display.
 */
export async function sendPaymentSuccessEmail({ name, email, courseTitle, amount, transactionId, receiptUrl }) {
  const formattedAmount = formatRupees(amount)
  const html = emailWrapper(
    'Payment successful',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Payment successful</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, your payment of <strong style="color:#12213B;">${formattedAmount}</strong> for <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong> was received.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border-radius:8px;padding:16px;">
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Transaction ID</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;font-family:monospace;">${escapeHtml(transactionId)}</td></tr>
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Amount</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;">${formattedAmount}</td></tr>
     </table>
     <p style="margin:24px 0;text-align:center;">
       <a href="${receiptUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Download Receipt</a>
     </p>
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       Thanks for your purchase!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Payment receipt — ${escapeHtml(courseTitle)}`, html })
}

/**
 * Refund email — sent after a refund is processed.
 * @param {{name: string, email: string, courseTitle: string, amount: number, refundId: string}} args
 *   amount is in PAISE.
 */
export async function sendRefundEmail({ name, email, courseTitle, amount, refundId }) {
  const formattedAmount = formatRupees(amount)
  const html = emailWrapper(
    'Refund processed',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Refund processed</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, a refund of <strong style="color:#12213B;">${formattedAmount}</strong> for <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong> has been processed.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border-radius:8px;padding:16px;">
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Refund ID</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;font-family:monospace;">${escapeHtml(refundId)}</td></tr>
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Amount</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;">${formattedAmount}</td></tr>
     </table>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       The refund will appear in your account within 5-7 business days.<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Refund processed — ${escapeHtml(courseTitle)}`, html })
}

/**
 * Certificate email — sent when a certificate is issued.
 * @param {{name: string, email: string, courseTitle: string, certificateUrl: string, certificateId: string}} args
 */
export async function sendCertificateEmail({ name, email, courseTitle, certificateUrl, certificateId }) {
  const html = emailWrapper(
    'Your certificate is ready!',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Your certificate is ready!</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, congratulations on completing <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong>! Your certificate of completion is ready to download.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${certificateUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">View Certificate</a>
     </p>
     <p style="margin:16px 0 0;font-size:12px;color:#a0aec0;">
       Certificate ID: <span style="font-family:monospace;">${escapeHtml(certificateId)}</span>
     </p>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       Well done!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Certificate — ${escapeHtml(courseTitle)}`, html })
}

/**
 * Coupon email — sent when a coupon is created (admin-side, optional).
 * @param {{name: string, email: string, couponCode: string, discount: string, expiresAt: string}} args
 */
export async function sendCouponEmail({ name, email, couponCode, discount, expiresAt }) {
  const html = emailWrapper(
    'A special offer just for you',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Special offer</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, here's a coupon just for you: <strong style="color:#12213B;">${escapeHtml(discount)}</strong> off your next enrollment.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <span style="display:inline-block;background-color:#EEF1F6;color:#12213B;padding:16px 32px;border-radius:8px;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;border:2px dashed #529286;">${escapeHtml(couponCode)}</span>
     </p>
     ${expiresAt ? `<p style="margin:16px 0 0;font-size:13px;color:#718096;">Expires on ${expiresAt}.</p>` : ''}
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Coupon: ${escapeHtml(couponCode)}`, html })
}

/**
 * Contact form email — sent to the platform admin's configured address.
 * @param {{name: string, email: string, message: string}} args
 */
export async function sendContactEmail({ name, email, message }) {
  const html = emailWrapper(
    'New contact form submission',
    `<h2 style="margin:0 0 16px;font-size:20px;color:#12213B;">New message from ${escapeHtml(name)}</h2>
     <p style="margin:0 0 8px;font-size:13px;color:#64748b;">From: <strong style="color:#12213B;">${escapeHtml(email)}</strong></p>
     <p style="margin:16px 0 8px;font-size:14px;color:#1a202c;white-space:pre-wrap;">${escapeHtml(message)}</p>`
  )
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM_ADDRESS || 'contact@eduzyra.com'
  return send({ to: adminEmail, subject: `Contact: ${escapeHtml(name)}`, html })
}

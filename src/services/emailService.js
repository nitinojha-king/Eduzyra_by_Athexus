import nodemailer from 'nodemailer'

/**
 * emailService — centralised outbound email for Eduzyra.
 *
 * Transport: SMTP (Gmail App Password OR Brevo SMTP — both work via the same
 * env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).
 *
 * Templates: all emails use inline-styled responsive HTML (email clients strip
 * <style> tags, so styles must be inline). Each function builds its own HTML
 * string with the Eduzyra header + body + footer.
 *
 * Error handling: every function wraps the send in try/catch and logs failures
 * via console.error. Email failures NEVER throw — a failed welcome email must
 * not fail the signup response. The caller's try/catch is a second safety net.
 *
 * Amounts: all DB amounts are in paise. Divide by 100 before displaying.
 * Use formatRupees() helper below — never inline the math.
 *
 * Security: all user-supplied values (name, email, message, courseTitle) are
 * HTML-escaped via the escapeHtml() helper before interpolation into templates.
 * This prevents HTML/script injection in email clients.
 */

// ── HTML escaping helper ──────────────────────────────────────────────────
// Escapes &, <, >, ", ' to prevent HTML injection in email templates.
// Every user-supplied value MUST be passed through this before interpolation.
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ── Lazy transporter singleton ────────────────────────────────────────────
// Lazily created on first send so the app can boot without SMTP configured.
// The error only surfaces when an email is actually sent.
let _transporter = null

function getTransporter() {
  if (_transporter) return _transporter

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT) || 587
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    throw new Error('SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env')
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user, pass },
  })

  return _transporter
}

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

/** Get the FROM address from env, with a sensible default. */
function fromAddress() {
  const name = process.env.EMAIL_FROM_NAME || 'Eduzyra'
  const addr = process.env.EMAIL_FROM_ADDRESS || 'noreply@eduzyra.dev'
  return `"${escapeHtml(name)}" <${addr}>`
}

/** Centralised send — wraps transporter.sendMail in try/catch, logs failures. */
async function send({ to, subject, html }) {
  try {
    const transporter = getTransporter()
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject,
      html,
    })
    return true
  } catch (err) {
    const errorMessage = err?.message || String(err)
    const isMissingSmtp = errorMessage.includes('SMTP not configured')

    if (isMissingSmtp && process.env.NODE_ENV !== 'production') {
      console.warn('[emailService] SMTP not configured. Dev fallback: email content will be logged to the console.')
      console.group('[emailService] DEV EMAIL OUTPUT')
      console.log('to:', to)
      console.log('subject:', subject)
      console.log('html:', html)
      console.groupEnd()
      return true
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
 * @param {{name: string, email: string, resetUrl: string}} args
 */
export async function sendPasswordResetEmail({ name, email, resetUrl }) {
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
       This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.
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
 * Contact form email — sent to the platform admin's FROM address.
 * @param {{name: string, email: string, message: string}} args
 */
export async function sendContactEmail({ name, email, message }) {
  const html = emailWrapper(
    'New contact form submission',
    `<h2 style="margin:0 0 16px;font-size:20px;color:#12213B;">New message from ${escapeHtml(name)}</h2>
     <p style="margin:0 0 8px;font-size:13px;color:#64748b;">From: <strong style="color:#12213B;">${escapeHtml(email)}</strong></p>
     <p style="margin:16px 0 8px;font-size:14px;color:#1a202c;white-space:pre-wrap;">${escapeHtml(message)}</p>`
  )
  const adminEmail = process.env.EMAIL_FROM_ADDRESS || 'noreply@eduzyra.dev'
  return send({ to: adminEmail, subject: `Contact: ${escapeHtml(name)}`, html })
}

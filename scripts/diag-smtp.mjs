import 'dotenv/config'
import { getTransporter } from '../src/services/emailService.js'

function maskString(str) {
  if (!str) return '(not set)'
  if (str.length <= 4) return '****'
  return `${str.slice(0, 2)}***${str.slice(-2)}`
}

function maskEmail(email) {
  if (!email) return '(not set)'
  const [user, domain] = email.split('@')
  if (!domain) return maskString(email)
  const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : `${user}***`
  return `${maskedUser}@${domain}`
}

async function run() {
  console.log('\n========================================')
  console.log('   Eduzyra SMTP Diagnostic Tool')
  console.log('========================================\n')

  const smtpUser = process.env.SMTP_USER
  const emailUser = process.env.EMAIL_USER
  const effectiveUser = (smtpUser || emailUser || '').trim()

  const smtpPass = process.env.SMTP_PASS
  const emailPass = process.env.EMAIL_PASS
  const rawPass = (smtpPass || emailPass || '').trim()

  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || '(auto: smtp.gmail.com)'
  const port = process.env.SMTP_PORT || process.env.EMAIL_PORT || '(auto: 465 / 587)'
  const fromName = process.env.EMAIL_FROM_NAME || 'Eduzyra'
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || effectiveUser || '(auto: matches user)'

  console.log('Environment variable checks:')
  console.log(`  NODE_ENV:           ${process.env.NODE_ENV || '(unset)'}`)
  console.log(`  SMTP_USER:          ${smtpUser ? maskEmail(smtpUser) : '(not set)'}`)
  console.log(`  EMAIL_USER:         ${emailUser ? maskEmail(emailUser) : '(not set)'}`)
  console.log(`  Resolved User:      ${maskEmail(effectiveUser)}`)
  console.log(`  SMTP_PASS:          ${smtpPass ? `[SET, length ${smtpPass.length}]` : '(not set)'}`)
  console.log(`  EMAIL_PASS:         ${emailPass ? `[SET, length ${emailPass.length}]` : '(not set)'}`)
  console.log(`  Resolved Pass:      ${rawPass ? `[SET, length ${rawPass.length}]` : '(not set)'}`)
  console.log(`  SMTP Host:          ${host}`)
  console.log(`  SMTP Port:          ${port}`)
  console.log(`  Sender From:        "${fromName}" <${maskEmail(fromAddress)}>`)
  console.log('----------------------------------------')

  if (!effectiveUser || !rawPass) {
    console.error('\n❌ ERROR: SMTP credentials missing!')
    console.error('Please configure SMTP_USER (or EMAIL_USER) and SMTP_PASS (or EMAIL_PASS) in .env or Render environment.')
    process.exit(1)
  }

  try {
    console.log('\nTesting SMTP transporter connection...')
    const transporter = getTransporter()
    await transporter.verify()
    console.log('✅ SMTP connection and authentication succeeded!')
  } catch (err) {
    console.error('\n❌ SMTP Verification FAILED:', err.message)
    if (err.message.includes('535') || err.message.includes('Username and Password not accepted')) {
      console.error('\n💡 HINT (Invalid Credentials):')
      console.error('  1. Ensure 2-Step Verification is enabled on your Google account.')
      console.error('  2. Generate a 16-character App Password at: https://myaccount.google.com/apppasswords')
      console.error('  3. Use the App Password instead of your normal Google login password.')
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      console.error('\n💡 HINT (Connection Timeout):')
      console.error('  Render or network may be blocking port 587. Check port 465 (SSL).')
    }
    process.exit(1)
  }

  const testRecipient = process.argv[2]
  if (testRecipient) {
    console.log(`\nSending test email to: ${testRecipient}...`)
    try {
      const transporter = getTransporter()
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: testRecipient,
        subject: 'Eduzyra SMTP Diagnostic Test',
        text: 'This is a test email verifying that Eduzyra SMTP email delivery is operational.',
      })
      console.log('✅ Test email delivered successfully!')
      console.log(`   Message ID: ${info.messageId}`)
    } catch (sendErr) {
      console.error('❌ Failed to deliver test email:', sendErr.message)
      process.exit(1)
    }
  } else {
    console.log('\n💡 Tip: You can send a test email by running:')
    console.log('   node scripts/diag-smtp.mjs your-email@example.com\n')
  }

  process.exit(0)
}

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})

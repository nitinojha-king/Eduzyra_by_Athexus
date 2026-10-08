#!/usr/bin/env node
import 'dotenv/config'
import { verifySmtpConnection, sendWelcomeEmail } from '../src/services/emailService.js'

async function run() {
  console.log('───────────────────────────────────────────────────────')
  console.log('  Eduzyra SMTP Email Diagnostic & Verification Tool')
  console.log('───────────────────────────────────────────────────────\n')

  const user = process.env.SMTP_USER || process.env.EMAIL_USER
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = process.env.SMTP_PORT || '587'
  const hasPass = Boolean(process.env.SMTP_PASS || process.env.EMAIL_PASS)

  console.log(`SMTP Host: ${host}:${port}`)
  console.log(`Account:   ${user ? user : '(not configured)'}`)
  console.log(`Password:  ${hasPass ? 'configured (16-char app password)' : '(not configured)'}\n`)

  if (!user || !hasPass) {
    console.error('❌ Missing credentials in .env:')
    console.error('   Please define either:')
    console.error('     EMAIL_USER=your_eduzyra_email@gmail.com')
    console.error('     EMAIL_PASS=your_16_digit_app_password')
    console.error('   OR:')
    console.error('     SMTP_USER=your_eduzyra_email@gmail.com')
    console.error('     SMTP_PASS=your_16_digit_app_password\n')
    process.exit(1)
  }

  console.log('Connecting to SMTP server and verifying authentication...')
  const result = await verifySmtpConnection()

  if (!result.success) {
    console.error('\n❌ SMTP Verification FAILED!')
    console.error(`   Error details: ${result.error}`)
    console.error('\nTroubleshooting tips for Gmail:')
    console.error(' 1. Ensure 2-Step Verification is turned ON for the Google account.')
    console.error(' 2. Verify that you generated an "App Password" (not your main Google password).')
    console.error(' 3. Ensure the App Password is 16 characters with no extra spaces.')
    process.exit(1)
  }

  console.log('✅ SMTP connection and authentication SUCCESSFUL!\n')

  const recipient = process.argv[2]
  if (recipient) {
    console.log(`Sending a test welcome email to: ${recipient}...`)
    const sent = await sendWelcomeEmail({
      name: 'Eduzyra Test User',
      email: recipient,
    })

    if (sent) {
      console.log(`✅ Test email successfully delivered to ${recipient}!`)
    } else {
      console.error(`❌ Test email sending failed. Check logs above.`)
      process.exit(1)
    }
  } else {
    console.log('ℹ️  Tip: To send a real test email, pass a recipient address:')
    console.log('     npm run test:email your-test-recipient@example.com\n')
  }
}

run()

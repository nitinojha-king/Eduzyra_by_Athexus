#!/usr/bin/env node
import 'dotenv/config'
import { verifyBrevoConnection, sendEnrollmentConfirmationEmail } from '../src/services/emailService.js'

function maskSecret(str) {
  if (!str) return '(not set)'
  if (str.length <= 8) return '****'
  return `${str.slice(0, 7)}***${str.slice(-4)}`
}

function maskEmail(email) {
  if (!email) return '(not set)'
  const [user, domain] = email.split('@')
  if (!domain) return maskSecret(email)
  const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : `${user}***`
  return `${maskedUser}@${domain}`
}

async function run() {
  console.log('───────────────────────────────────────────────────────')
  console.log('  Eduzyra Brevo Email Diagnostic & Verification Tool')
  console.log('───────────────────────────────────────────────────────\n')

  const apiKey = (process.env.BREVO_API_KEY || '').trim()
  const fromName = (process.env.EMAIL_FROM_NAME || 'Eduzyra').trim()
  const fromAddress = (process.env.EMAIL_FROM_ADDRESS || process.env.BREVO_SENDER_EMAIL || '').trim()

  console.log(`Service:  Brevo Transactional REST API (HTTPS / port 443)`)
  console.log(`API Key:  ${maskSecret(apiKey)}`)
  console.log(`Sender:   "${fromName}" <${fromAddress ? maskEmail(fromAddress) : 'contact@eduzyra.com'}>\n`)

  if (!apiKey) {
    console.error('❌ Missing BREVO_API_KEY in .env:')
    console.error('   Please define:')
    console.error('     BREVO_API_KEY=xkeysib-your-v3-api-key\n')
    process.exit(1)
  }

  console.log('Connecting to Brevo API and verifying authentication...')
  const result = await verifyBrevoConnection()

  if (!result.success) {
    console.error('\n❌ Brevo Verification FAILED!')
    console.error(`   Error details: ${result.error}`)
    console.error('\nTroubleshooting tips for Brevo:')
    console.error(' 1. Verify that your API key starts with "xkeysib-".')
    console.error(' 2. Confirm the key has permissions for transactional emails in https://app.brevo.com/settings/keys/api.')
    console.error(' 3. Ensure your sender email or domain is verified in https://app.brevo.com/senders.')
    process.exit(1)
  }

  console.log('✅ Brevo connection and authentication SUCCESSFUL!\n')

  const recipient = process.argv[2]
  if (recipient) {
    console.log(`Sending a test enrollment email to: ${recipient}...`)
    const sent = await sendEnrollmentConfirmationEmail({
      name: 'Eduzyra Test User',
      email: recipient,
      courseTitle: 'Test Course',
      courseUrl: `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/courses`,
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

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})

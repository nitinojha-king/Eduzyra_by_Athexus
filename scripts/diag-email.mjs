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
  console.log('\n========================================')
  console.log('   Eduzyra Brevo Email Diagnostic Tool')
  console.log('========================================\n')

  const apiKey = (process.env.BREVO_API_KEY || '').trim()
  const fromName = (process.env.EMAIL_FROM_NAME || 'Eduzyra').trim()
  const fromAddress = (process.env.EMAIL_FROM_ADDRESS || process.env.BREVO_SENDER_EMAIL || '').trim()

  console.log('Environment variable checks:')
  console.log(`  NODE_ENV:             ${process.env.NODE_ENV || '(unset)'}`)
  console.log(`  BREVO_API_KEY:        ${maskSecret(apiKey)} [length: ${apiKey.length}]`)
  console.log(`  EMAIL_FROM_NAME:      ${fromName}`)
  console.log(`  EMAIL_FROM_ADDRESS:   ${fromAddress ? maskEmail(fromAddress) : '(not set — fallback: contact@eduzyra.com)'}`)
  console.log('----------------------------------------')

  if (!apiKey) {
    console.error('\n❌ ERROR: BREVO_API_KEY is missing!')
    console.error('Please configure BREVO_API_KEY in your .env or Render environment.')
    console.error('To obtain an API key:')
    console.error('  1. Log in to https://app.brevo.com')
    console.error('  2. Go to SMTP & API -> API Keys (https://app.brevo.com/settings/keys/api)')
    console.error('  3. Generate a new v3 API key (starts with xkeysib-)\n')
    process.exit(1)
  }

  try {
    console.log('\nTesting Brevo REST API connection & authentication...')
    const result = await verifyBrevoConnection()
    if (!result.success) {
      console.error('\n❌ Brevo Verification FAILED:', result.error)
      if (result.error.includes('401') || result.error.includes('unauthorized') || result.error.includes('authentication')) {
        console.error('\n💡 HINT (Invalid API Key):')
        console.error('  Ensure your BREVO_API_KEY starts with "xkeysib-" and has not expired or been revoked.')
      }
      process.exit(1)
    }

    console.log('✅ Brevo connection and authentication succeeded!')
    if (result.account) {
      console.log(`  Brevo Account Email: ${maskEmail(result.account.email)}`)
      if (result.account.companyName) console.log(`  Company:             ${result.account.companyName}`)
      if (result.account.plan) console.log(`  Plan:                ${JSON.stringify(result.account.plan)}`)
    }
  } catch (err) {
    console.error('\n❌ Unexpected error during verification:', err.message)
    process.exit(1)
  }

  const testRecipient = process.argv[2]
  if (testRecipient) {
    console.log(`\nSending test enrollment email via Brevo to: ${testRecipient}...`)
    try {
      const sent = await sendEnrollmentConfirmationEmail({
        name: 'Eduzyra Diagnostic Tester',
        email: testRecipient,
        courseTitle: 'Test Course',
        courseUrl: `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/courses`,
      })
      if (sent) {
        console.log('✅ Test email delivered successfully via Brevo!')
      } else {
        console.error('❌ Failed to deliver test email. Check server console logs.')
        process.exit(1)
      }
    } catch (sendErr) {
      console.error('❌ Failed to deliver test email:', sendErr.message)
      process.exit(1)
    }
  } else {
    console.log('\n💡 Tip: You can test sending a live email by running:')
    console.log('   node scripts/diag-email.mjs your-email@example.com\n')
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})

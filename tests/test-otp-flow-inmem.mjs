import assert from 'node:assert/strict'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import nodemailer from 'nodemailer'
import app from '../src/app.js'
import User from '../src/models/User.js'
import { getTransporter, resetTransporter, setTransporter } from '../src/services/emailService.js'
import { hashOtp } from '../src/utils/otp.js'

/**
 * End-to-End In-Memory Test Suite:
 * Complete Signup, OTP Generation, Verification, Resend, and Configuration Flow
 */
async function runTests() {
  console.log('\n======================================================')
  console.log('   Running Complete OTP Flow & Email Verification Tests')
  console.log('======================================================\n')

  // Set test environment
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test_jwt_secret_for_unit_tests_12345678'

  // 1. Start in-memory MongoDB
  const mongoServer = await MongoMemoryServer.create()
  const mongoUri = mongoServer.getUri()
  await mongoose.connect(mongoUri)
  console.log('✅ In-memory MongoDB connected')

  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    // -------------------------------------------------------------
    // Test 1: Configuration & Aliases (EMAIL_USER / EMAIL_PASS)
    // -------------------------------------------------------------
    console.log('\n[Test 1] Verifying SMTP environment variable aliases & Google App Password formatting...')
    resetTransporter()
    process.env.EMAIL_USER = 'testteacher@gmail.com'
    process.env.EMAIL_PASS = 'abcd efgh ijkl mnop' // 16-char app password with spaces
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS

    const transporter = getTransporter({ reload: true })
    assert.equal(transporter.options.auth.user, 'testteacher@gmail.com', 'EMAIL_USER must be resolved')
    assert.equal(transporter.options.auth.pass, 'abcdefghijklmnop', '16-char Google App Password spaces must be stripped')
    assert.equal(transporter.options.service, 'gmail', 'Gmail service must be auto-detected for @gmail.com')
    assert.equal(transporter.options.connectionTimeout, 15000, 'Connection timeout must be 15000ms')
    console.log('✅ Test 1 Passed: EMAIL_USER/EMAIL_PASS and Gmail sanitization verified.')

    // -------------------------------------------------------------
    // Test 2: Missing Credentials Error Validation
    // -------------------------------------------------------------
    console.log('\n[Test 2] Testing missing SMTP credentials error handling...')
    resetTransporter()
    delete process.env.EMAIL_USER
    delete process.env.EMAIL_PASS
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS

    assert.throws(
      () => getTransporter({ reload: true }),
      /SMTP not configured — set SMTP_USER \/ EMAIL_USER and SMTP_PASS \/ EMAIL_PASS in .env/,
      'Must throw clear error when credentials are missing',
    )
    console.log('✅ Test 2 Passed: Missing credentials cleanly detected without leaking secrets.')

    // Setup mock jsonTransport to capture outbound emails hermetically during test run
    const sentEmails = []
    const mockTransport = nodemailer.createTransport({
      jsonTransport: true,
    })
    const originalSendMail = mockTransport.sendMail.bind(mockTransport)
    mockTransport.sendMail = async (options) => {
      const result = await originalSendMail(options)
      const parsed = JSON.parse(result.message)
      sentEmails.push({ ...options, parsed })
      return result
    }
    setTransporter(mockTransport)
    process.env.EMAIL_USER = 'eduzyra.official@gmail.com'
    process.env.EMAIL_PASS = 'mockpassword1234'

    // -------------------------------------------------------------
    // Test 3: Signup creates unverified account, stores hashed OTP & sends email
    // -------------------------------------------------------------
    console.log('\n[Test 3] Testing Signup API & OTP creation...')
    const testUser = {
      name: 'Rohan Sharma',
      email: 'rohan.sharma@example.com',
      password: 'SecurePassword123',
    }

    sentEmails.length = 0
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    })
    const signupData = await signupRes.json()
    assert.equal(signupRes.status, 201, 'Signup must return HTTP 201')
    assert.equal(signupData.requiresOtp, true, 'Signup must require OTP')
    assert.equal(signupData.email, testUser.email, 'Returned email must match')
    assert.equal(signupData.emailSent, true, 'Email dispatch must succeed')

    // Inspect user in DB
    const dbUser = await User.findOne({ email: testUser.email }).select('+otpCode +otpExpires +otpAttempts')
    assert.ok(dbUser, 'User must exist in database')
    assert.equal(dbUser.isVerified, false, 'User must initially be unverified')
    assert.ok(dbUser.otpCode, 'Hashed OTP code must exist in DB')
    assert.equal(dbUser.otpCode.length, 64, 'otpCode must be a 64-char SHA-256 hash')
    assert.ok(dbUser.otpExpires > new Date(), 'OTP expiration must be in the future')

    // Verify email was actually dispatched to user's registered email
    assert.equal(sentEmails.length, 1, 'Exactly one OTP email must be dispatched')
    assert.equal(sentEmails[0].to, testUser.email, 'Email must be sent to registered user')
    assert.match(sentEmails[0].subject, /verification code/i, 'Subject must mention verification code')
    assert.match(sentEmails[0].from, /eduzyra\.official@gmail\.com/, 'From header must match authenticated Gmail account')
    console.log('✅ Test 3 Passed: User created unverified, hashed in DB, and OTP email delivered to recipient.')

    // -------------------------------------------------------------
    // Test 4: Unverified user cannot log in
    // -------------------------------------------------------------
    console.log('\n[Test 4] Verifying unverified account login block...')
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    })
    const loginData = await loginRes.json()
    assert.equal(loginRes.status, 403, 'Login must be blocked with 403 Forbidden')
    assert.equal(loginData.errorCode, 'EMAIL_NOT_VERIFIED', 'Error code must be EMAIL_NOT_VERIFIED')
    console.log('✅ Test 4 Passed: Login prevented with EMAIL_NOT_VERIFIED.')

    // -------------------------------------------------------------
    // Test 5: OTP validation schema checks (string & number, rejects invalid formats)
    // -------------------------------------------------------------
    console.log('\n[Test 5] Testing OTP validation schema with various formats...')
    // 5a. Reject 5 digits
    const res5 = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, otp: 12345 }),
    })
    assert.equal(res5.status, 400, '5-digit OTP must be rejected')

    // 5b. Reject 7 digits
    const res7 = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, otp: 1234567 }),
    })
    assert.equal(res7.status, 400, '7-digit OTP must be rejected')

    // 5c. Reject non-digits
    const resAlpha = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, otp: 'abcdef' }),
    })
    assert.equal(resAlpha.status, 400, 'Non-digit OTP must be rejected')
    console.log('✅ Test 5 Passed: Malformed OTP formats strictly rejected by validation schema.')

    // -------------------------------------------------------------
    // Test 6: Incorrect OTP fails & increments attempts
    // -------------------------------------------------------------
    console.log('\n[Test 6] Testing incorrect OTP validation...')
    const wrongOtpRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        otp: '999999',
      }),
    })
    const wrongOtpData = await wrongOtpRes.json()
    assert.equal(wrongOtpRes.status, 400, 'Wrong OTP must return 400')
    assert.equal(wrongOtpData.errorCode, 'OTP_INVALID', 'Error code must be OTP_INVALID')

    const dbUserAfterWrong = await User.findOne({ email: testUser.email }).select('+otpAttempts')
    assert.equal(dbUserAfterWrong.otpAttempts, 1, 'otpAttempts must increment to 1')
    console.log('✅ Test 6 Passed: Incorrect OTP rejected and attempts tracked.')

    // -------------------------------------------------------------
    // Test 7: Correct numeric OTP verification activates account & logs in
    // -------------------------------------------------------------
    console.log('\n[Test 7] Testing valid NUMERIC OTP confirmation (frontend sending number)...')
    const knownOtp = '123456'
    dbUser.otpCode = hashOtp(knownOtp)
    dbUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000)
    await dbUser.save()

    sentEmails.length = 0
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        otp: 123456, // NUMERIC OTP from frontend
      }),
    })
    const verifyData = await verifyRes.json()
    assert.equal(verifyRes.status, 200, 'Verify numeric OTP must return 200 OK')
    assert.ok(verifyData.token, 'Must return JWT token')
    assert.equal(verifyData.user.isVerified, true, 'User in response must be verified')

    const dbUserVerified = await User.findOne({ email: testUser.email }).select('+otpCode +otpExpires')
    assert.equal(dbUserVerified.isVerified, true, 'Database isVerified must be true')
    assert.equal(dbUserVerified.otpCode, undefined, 'otpCode must be cleared')
    assert.equal(dbUserVerified.otpExpires, undefined, 'otpExpires must be cleared')

    // Verify welcome email was dispatched upon verification
    assert.equal(sentEmails.length, 1, 'Welcome email must be sent upon verification')
    assert.equal(sentEmails[0].to, testUser.email, 'Welcome email must be sent to verified student')
    assert.match(sentEmails[0].subject, /Welcome to Eduzyra/i, 'Subject must be Welcome to Eduzyra')
    console.log('✅ Test 7 Passed: Numeric OTP accepted, account activated, and welcome email delivered.')

    // -------------------------------------------------------------
    // Test 8: Already-verified account cannot verify OTP again
    // -------------------------------------------------------------
    console.log('\n[Test 8] Testing already-verified account OTP block...')
    const reVerifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        otp: '123456',
      }),
    })
    assert.equal(reVerifyRes.status, 400, 'Re-verifying an active account must return 400')
    console.log('✅ Test 8 Passed: Verified accounts cannot re-verify OTP.')

    // -------------------------------------------------------------
    // Test 9: Verified user can log in successfully
    // -------------------------------------------------------------
    console.log('\n[Test 9] Testing login after verification...')
    const verifiedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    })
    const verifiedLoginData = await verifiedLoginRes.json()
    assert.equal(verifiedLoginRes.status, 200, 'Login must succeed with 200 OK')
    assert.ok(verifiedLoginData.token, 'Must receive token upon login')
    console.log('✅ Test 9 Passed: Verified user logged in successfully.')

    // -------------------------------------------------------------
    // Test 10: Resend OTP cooldown enforcement
    // -------------------------------------------------------------
    console.log('\n[Test 10] Testing resend OTP cooldown...')
    const secondUser = {
      name: 'Priya Patel',
      email: 'priya.patel@example.com',
      password: 'SecurePassword456',
    }
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secondUser),
    })

    const resendImmediateRes = await fetch(`${baseUrl}/api/auth/resend-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: secondUser.email }),
    })
    const resendImmediateData = await resendImmediateRes.json()
    assert.equal(resendImmediateRes.status, 429, 'Immediate resend must be rate limited with 429')
    assert.equal(resendImmediateData.errorCode, 'OTP_COOLDOWN', 'Error code must be OTP_COOLDOWN')
    console.log('✅ Test 10 Passed: Resend cooldown correctly enforced.')

    // -------------------------------------------------------------
    // Test 11: Unverified user re-signing up recovers gracefully
    // -------------------------------------------------------------
    console.log('\n[Test 11] Testing unverified user re-signup recovery...')
    const reSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Priya Updated',
        email: secondUser.email,
        password: 'NewSecurePassword789',
      }),
    })
    const reSignupData = await reSignupRes.json()
    assert.equal(reSignupRes.status, 200, 'Re-signup for unverified user must return 200 OK')
    assert.equal(reSignupData.requiresOtp, true, 'Must still require OTP')
    console.log('✅ Test 11 Passed: Unverified user re-signing up recovers cleanly without 409 conflict.')

    console.log('\n======================================================')
    console.log('   🎉 All 11 OTP & Auth Flow Tests Passed Successfully!')
    console.log('======================================================\n')
  } finally {
    server.close()
    await mongoose.connection.close()
    await mongoServer.stop()
    process.exit(0)
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err)
  process.exit(1)
})

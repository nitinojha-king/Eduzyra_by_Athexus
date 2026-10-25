import assert from 'node:assert/strict'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import app from '../src/app.js'
import User from '../src/models/User.js'
import { setMockGoogleVerifier, resetMockGoogleVerifier } from '../src/services/googleAuth.js'
import { setMockSender, resetMockSender } from '../src/services/emailService.js'

async function runTests() {
  console.log('\n======================================================')
  console.log('   Running Google Sign-In Flow Tests')
  console.log('======================================================\n')

  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_google_tests_12345678'
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
  delete process.env.GOOGLE_ALLOWED_DOMAINS

  const mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
  await User.init()
  console.log('✅ In-memory MongoDB connected')

  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const sentEmails = []
  setMockSender(async (options) => {
    sentEmails.push(options)
    return true
  })

  // Token → payload lookup lets each test describe exactly what Google would
  // have returned, without contacting Google.
  const tokenPayloads = new Map()
  setMockGoogleVerifier(async (credential) => {
    const payload = tokenPayloads.get(credential)
    if (!payload) throw new Error('Invalid token signature')
    return payload
  })

  function issueToken(payload) {
    const credential = `mock-google-${payload.sub}-${Math.random().toString(36).slice(2)}`
    tokenPayloads.set(credential, payload)
    return credential
  }

  async function postJson(path, body, token) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    return { res, data: await res.json().catch(() => ({})) }
  }

  async function patchJson(path, body, token) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    return { res, data: await res.json().catch(() => ({})) }
  }

  let failed = false
  try {
    // -------------------------------------------------------------
    // Test 1: validation rejects a missing credential
    // -------------------------------------------------------------
    console.log('\n[Test 1] Missing credential validation...')
    {
      const { res, data } = await postJson('/api/auth/google', {})
      assert.equal(res.status, 400, 'Missing credential must return 400')
      assert.match(data.message, /credential/i)
      console.log('✅ Test 1 Passed: missing credential rejected.')
    }

    // -------------------------------------------------------------
    // Test 2: invalid token is rejected with 401
    // -------------------------------------------------------------
    console.log('\n[Test 2] Invalid Google token...')
    {
      const { res, data } = await postJson('/api/auth/google', { credential: 'not-a-real-token' })
      assert.equal(res.status, 401, 'Invalid token must return 401')
      assert.equal(data.errorCode, 'INVALID_GOOGLE_TOKEN')
      console.log('✅ Test 2 Passed: invalid token rejected.')
    }

    // -------------------------------------------------------------
    // Test 3: unverified Google email is rejected
    // -------------------------------------------------------------
    console.log('\n[Test 3] Unverified Google email...')
    {
      const credential = issueToken({
        sub: 'google-sub-unverified',
        email: 'unverified@gmail.com',
        email_verified: false,
        name: 'Unverified User',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 403, 'Unverified Google email must return 403')
      assert.equal(data.errorCode, 'GOOGLE_EMAIL_NOT_VERIFIED')
      assert.equal(await User.countDocuments({ email: 'unverified@gmail.com' }), 0)
      console.log('✅ Test 3 Passed: unverified Google email rejected.')
    }

    // -------------------------------------------------------------
    // Test 4: a new Google user is created, passwordless, no auth email
    // -------------------------------------------------------------
    console.log('\n[Test 4] First-time Google signup...')
    let googleUser
    {
      sentEmails.length = 0
      const credential = issueToken({
        sub: 'google-sub-new',
        email: 'NEW.USER@GMAIL.COM',
        email_verified: true,
        name: 'New Google User',
        picture: 'https://lh3.googleusercontent.com/a/test-avatar',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 200, 'Google signup must return 200')
      assert.ok(data.token, 'Must return a JWT')
      assert.equal(data.isNewUser, true, 'First login must be flagged as new')
      assert.equal(data.user.email, 'new.user@gmail.com', 'Email must be normalized')
      assert.equal(data.user.role, 'student', 'New Google users are students')
      assert.equal(data.user.googleLinked, true, 'Safe object must expose the Google link')
      assert.equal(data.user.hasPassword, false, 'Google-only user has no password')

      googleUser = await User.findOne({ email: 'new.user@gmail.com' }).select('+password')
      assert.ok(googleUser, 'User must exist in MongoDB')
      assert.equal(googleUser.googleId, 'google-sub-new')
      assert.equal(googleUser.password, undefined, 'No password hash must be stored')
      assert.equal(googleUser.hasPassword, false)
      assert.equal(googleUser.avatar, 'https://lh3.googleusercontent.com/a/test-avatar')
      assert.equal(sentEmails.length, 0, 'Google signup must not send an auth email')

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
      })
      assert.equal(meRes.status, 200, 'Issued JWT must work')
      const meData = await meRes.json()
      assert.equal(meData.user.id, data.user.id)
      console.log('✅ Test 4 Passed: account created, passwordless, JWT valid, no auth email.')
    }

    // -------------------------------------------------------------
    // Test 5: repeat Google login is idempotent
    // -------------------------------------------------------------
    console.log('\n[Test 5] Repeat Google login...')
    {
      const credential = issueToken({
        sub: 'google-sub-new',
        email: 'new.user@gmail.com',
        email_verified: true,
        name: 'New Google User',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 200)
      assert.equal(data.isNewUser, false)
      assert.equal(String(data.user.id), String(googleUser._id))
      assert.equal(await User.countDocuments({ email: 'new.user@gmail.com' }), 1, 'No duplicate user')
      console.log('✅ Test 5 Passed: repeat login reuses the same account.')
    }

    // -------------------------------------------------------------
    // Test 6: Google links to an existing password account
    // -------------------------------------------------------------
    console.log('\n[Test 6] Linking an existing local account...')
    {
      const local = await User.create({
        name: 'Local Instructor',
        email: 'local.instructor@example.com',
        password: 'LocalPass123',
        role: 'instructor',
      })

      const credential = issueToken({
        sub: 'google-sub-linked',
        email: 'local.instructor@example.com',
        email_verified: true,
        name: 'Local Instructor',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 200, 'Link/login must succeed')
      assert.equal(String(data.user.id), String(local._id), 'Must log into the existing account')
      assert.equal(data.user.role, 'instructor', 'Role must be preserved')
      assert.equal(data.user.googleLinked, true)
      assert.equal(data.user.hasPassword, true, 'Password remains usable')

      const relinked = await User.findById(local._id).select('+password')
      assert.equal(relinked.googleId, 'google-sub-linked')
      assert.ok(await relinked.comparePassword('LocalPass123'), 'Existing password must still work')

      const { res: loginRes, data: loginData } = await postJson('/api/auth/login', {
        email: 'local.instructor@example.com',
        password: 'LocalPass123',
      })
      assert.equal(loginRes.status, 200, 'Password login must still work after linking')
      assert.ok(loginData.token)
      console.log('✅ Test 6 Passed: existing account linked without losing password/role.')
    }

    // -------------------------------------------------------------
    // Test 7: Google links to an existing password account with no avatar
    // -------------------------------------------------------------
    console.log('\n[Test 7] Linking an existing account without Google data...')
    {
      const existing = await User.create({
        name: 'Existing Student',
        email: 'existing.student@example.com',
        password: 'ExistingPass123',
        role: 'student',
      })

      const credential = issueToken({
        sub: 'google-sub-existing',
        email: 'existing.student@example.com',
        email_verified: true,
        name: 'Existing Student',
        picture: 'https://lh3.googleusercontent.com/a/existing-avatar',
      })
      const { res } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 200)

      const linked = await User.findById(existing._id)
      assert.equal(linked.googleId, 'google-sub-existing')
      assert.equal(linked.avatar, 'https://lh3.googleusercontent.com/a/existing-avatar')

      const { res: loginRes } = await postJson('/api/auth/login', {
        email: 'existing.student@example.com',
        password: 'ExistingPass123',
      })
      assert.equal(loginRes.status, 200, 'Existing password login still works after linking')
      console.log('✅ Test 7 Passed: existing account linked and avatar filled.')
    }

    // -------------------------------------------------------------
    // Test 8: password login is blocked for Google-only accounts
    // -------------------------------------------------------------
    console.log('\n[Test 8] Password login on a Google-only account...')
    {
      const { res, data } = await postJson('/api/auth/login', {
        email: 'new.user@gmail.com',
        password: 'anything123',
      })
      assert.equal(res.status, 401, 'Password login must be rejected')
      assert.equal(data.errorCode, 'USE_GOOGLE_SIGN_IN')
      console.log('✅ Test 8 Passed: passwordless account cannot use password login.')
    }

    // -------------------------------------------------------------
    // Test 9: Google-only user can set a password, then manage it
    // -------------------------------------------------------------
    console.log('\n[Test 9] Setting/changing a password on a Google-only account...')
    {
      const credential = issueToken({
        sub: 'google-sub-new',
        email: 'new.user@gmail.com',
        email_verified: true,
        name: 'New Google User',
      })
      const { data: loginData } = await postJson('/api/auth/google', { credential })

      const { res: setRes, data: setData } = await patchJson(
        '/api/auth/me',
        { newPassword: 'FirstPassword123' },
        loginData.token,
      )
      assert.equal(setRes.status, 200, 'Initial password set must succeed without currentPassword')
      assert.equal(setData.user.hasPassword, true)

      const { res: firstLoginRes, data: firstLoginData } = await postJson('/api/auth/login', {
        email: 'new.user@gmail.com',
        password: 'FirstPassword123',
      })
      assert.equal(firstLoginRes.status, 200, 'Password login must work after setting one')

      const { res: noCurrentRes, data: noCurrentData } = await patchJson(
        '/api/auth/me',
        { newPassword: 'SecondPassword123' },
        firstLoginData.token,
      )
      assert.equal(noCurrentRes.status, 400, 'Changing an existing password requires currentPassword')
      assert.equal(noCurrentData.errorCode, 'CURRENT_PASSWORD_REQUIRED')

      const { res: changeRes } = await patchJson(
        '/api/auth/me',
        { currentPassword: 'FirstPassword123', newPassword: 'SecondPassword123' },
        firstLoginData.token,
      )
      assert.equal(changeRes.status, 200, 'Password change with currentPassword must succeed')

      const { res: finalLoginRes } = await postJson('/api/auth/login', {
        email: 'new.user@gmail.com',
        password: 'SecondPassword123',
      })
      assert.equal(finalLoginRes.status, 200)
      console.log('✅ Test 9 Passed: Google-only user can set and change a password.')
    }

    // -------------------------------------------------------------
    // Test 10: conflicting Google identity for a linked email
    // -------------------------------------------------------------
    console.log('\n[Test 10] Conflicting Google identity...')
    {
      const credential = issueToken({
        sub: 'google-sub-different',
        email: 'local.instructor@example.com',
        email_verified: true,
        name: 'Different Google Account',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 409, 'A different Google sub for a linked email must be rejected')
      assert.equal(data.errorCode, 'GOOGLE_ACCOUNT_CONFLICT')
      console.log('✅ Test 10 Passed: conflicting Google identities rejected.')
    }

    // -------------------------------------------------------------
    // Test 11: optional domain allowlist
    // -------------------------------------------------------------
    console.log('\n[Test 11] GOOGLE_ALLOWED_DOMAINS enforcement...')
    {
      process.env.GOOGLE_ALLOWED_DOMAINS = 'gmail.com'
      const credential = issueToken({
        sub: 'google-sub-domain',
        email: 'person@example.com',
        email_verified: true,
        name: 'Domain User',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 403, 'Disallowed domain must return 403')
      assert.equal(data.errorCode, 'GOOGLE_DOMAIN_NOT_ALLOWED')
      assert.equal(await User.countDocuments({ email: 'person@example.com' }), 0)
      delete process.env.GOOGLE_ALLOWED_DOMAINS
      console.log('✅ Test 11 Passed: domain allowlist enforced.')
    }

    // -------------------------------------------------------------
    // Test 12: a Google account for a disallowed domain still works once
    //          the allowlist is removed (env is read dynamically)
    // -------------------------------------------------------------
    console.log('\n[Test 12] Domain allowlist is dynamic...')
    {
      const credential = issueToken({
        sub: 'google-sub-domain',
        email: 'person@example.com',
        email_verified: true,
        name: 'Domain User',
      })
      const { res, data } = await postJson('/api/auth/google', { credential })
      assert.equal(res.status, 200)
      assert.equal(data.user.email, 'person@example.com')
      console.log('✅ Test 12 Passed: allowlist changes apply without a restart.')
    }

    // -------------------------------------------------------------
    // Test 13: removed signup/OTP/password-reset endpoints are gone
    // -------------------------------------------------------------
    console.log('\n[Test 13] Removed auth endpoints return 404...')
    {
      const removed = [
        ['/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'Password123' }],
        ['/api/auth/verify-otp', { email: 'x@example.com', otp: '123456' }],
        ['/api/auth/resend-otp', { email: 'x@example.com' }],
        ['/api/auth/forgot-password', { email: 'x@example.com' }],
        ['/api/auth/reset-password', { token: 'abc', password: 'Password123' }],
      ]

      for (const [path, body] of removed) {
        const { res } = await postJson(path, body)
        assert.equal(res.status, 404, `${path} must be removed`)
      }

      const devOtpRes = await fetch(`${baseUrl}/api/auth/dev/otp?email=x@example.com`)
      assert.equal(devOtpRes.status, 404, '/api/auth/dev/otp must be removed')
      console.log('✅ Test 13 Passed: removed auth endpoints are unpublished.')
    }

    // -------------------------------------------------------------
    // Test 14: clear failure when the server has no client ID configured
    // -------------------------------------------------------------
    console.log('\n[Test 14] Missing GOOGLE_CLIENT_ID configuration...')
    {
      resetMockGoogleVerifier()
      delete process.env.GOOGLE_CLIENT_ID
      const { res, data } = await postJson('/api/auth/google', { credential: 'any-token' })
      assert.equal(res.status, 503, 'Missing server configuration must return 503')
      assert.equal(data.errorCode, 'GOOGLE_NOT_CONFIGURED')
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
      setMockGoogleVerifier(async (credential) => {
        const payload = tokenPayloads.get(credential)
        if (!payload) throw new Error('Invalid token signature')
        return payload
      })
      console.log('✅ Test 14 Passed: missing client ID fails clearly.')
    }

    console.log('\n======================================================')
    console.log('   🎉 All 14 Google Sign-In Tests Passed Successfully!')
    console.log('======================================================\n')
  } catch (err) {
    failed = true
    console.error('\n❌ Test Suite Failed:', err)
  } finally {
    resetMockGoogleVerifier()
    resetMockSender()
    server.close()
    await mongoose.connection.close()
    await mongoServer.stop()
    process.exit(failed ? 1 : 0)
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err)
  process.exit(1)
})

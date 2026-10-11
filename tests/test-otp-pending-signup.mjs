// Verifies the pending-signup OTP flow: no User row exists until the emailed
// code is confirmed, retrying signup re-issues instead of 409, and the
// confirmed account can log in with the original password.
import assert from 'node:assert/strict'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import 'dotenv/config'

process.env.NODE_ENV = 'development'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_unit_tests_12345678'

const mongod = await MongoMemoryServer.create()
await mongoose.connect(mongod.getUri('otp-flow-test'))

const { signup, verifyOtp, resendOtp, login } = await import('../src/controllers/authController.js')
const { getDevOtp } = await import('../src/controllers/authController.js')
const User = (await import('../src/models/User.js')).default
const PendingSignup = (await import('../src/models/PendingSignup.js')).default
const { signupSchema, verifyOtpSchema, resendOtpSchema, loginSchema } = await import('../src/validators/index.js')

function mockRes() {
  const res = {}
  res.statusCode = 200
  res.body = undefined
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}

async function invoke(fn, schema, body, extraReq = {}) {
  // Mirror the real middleware so validatedBody is populated exactly as in prod.
  const parsed = schema.safeParse(body)
  assert.ok(parsed.success, `validation failed: ${parsed.error?.issues?.map((i) => i.message).join(', ')}`)

  const req = { validatedBody: parsed.data, body: parsed.data, ...extraReq }
  const res = mockRes()
  let nextErr = null
  let settled = false
  const origJson = res.json
  res.json = (b) => { res.body = b; settled = true; return res }
  fn(req, res, (e) => { nextErr = e || null; settled = true })
  const deadline = Date.now() + 15000
  while (!settled && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5))
  }
  if (!settled) {
    assert.fail(`handler did not respond within 15s (last body: ${origJson ? 'none' : 'partial'})`)
  }
  if (nextErr) throw nextErr
  return { res, body: res.body }
}

const EMAIL = 'otp-flow-tester@example.com'
const GOOD = { name: 'OTP Tester', email: EMAIL, password: 'Password1' }
let passed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`)
    process.exitCode = 1
  }
}

// Dev fallback logs the mail instead of sending it — no SMTP needed.
console.log('\nPendingSignup OTP flow\n----------------------')

await test('signup creates NO User row, only a pending staging record', async () => {
  const { res } = await invoke(signup, signupSchema, GOOD)
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.requiresOtp, true)

  assert.equal(await User.countDocuments({ email: EMAIL }), 0, 'User row must NOT exist before OTP confirmation')
  assert.equal(await PendingSignup.countDocuments({ email: EMAIL }), 1, 'pending signup must be staged')

  const pending = await PendingSignup.findOne({ email: EMAIL }).select('+passwordHash')
  assert.ok(pending.passwordHash.startsWith('$2'), 'pending record must store a bcrypt hash')
  assert.notEqual(pending.passwordHash, GOOD.password, 'raw password must never be stored')
})

await test('the pending record keeps a hashed OTP, never the raw code', async () => {
  const pending = await PendingSignup.findOne({ email: EMAIL }).select('+otpCode +otpExpires')
  assert.ok(pending.otpCode, 'otp hash stored')
  assert.match(pending.otpCode, /^[a-f0-9]{64}$/, 'otpCode must be a sha-256 hex digest')
  assert.ok(pending.otpExpires > new Date(), 'otp expiry set')
})

await test('wrong OTP is rejected and increments the attempt counter', async () => {
  const before = await PendingSignup.findOne({ email: EMAIL }).select('+otpAttempts')
  await assert.rejects(
    () => invoke(verifyOtp, verifyOtpSchema, { email: EMAIL, otp: '000000' }),
    /Incorrect code/,
  )
  const after = await PendingSignup.findOne({ email: EMAIL }).select('+otpAttempts')
  assert.equal(after.otpAttempts, before.otpAttempts + 1)
})

await test('signup retry re-issues the code instead of returning 409', async () => {
  const { res } = await invoke(signup, signupSchema, { ...GOOD, password: 'Password2' })
  assert.equal(res.statusCode, 201, 'retry must succeed, not conflict')
  assert.equal(await User.countDocuments({ email: EMAIL }), 0)
})

await test('account is created in the database only after the correct OTP', async () => {
// getDevOtp reads req.query and is only mounted in non-production.
const passthrough = { safeParse: (v) => ({ success: true, data: v }) }
const { body: devOtp } = await invoke(getDevOtp, passthrough, {}, { query: { email: EMAIL } })
const { otp } = devOtp

  const { body } = await invoke(verifyOtp, verifyOtpSchema, { email: EMAIL, otp })
  assert.ok(body.token, 'verification returns a login token')
  assert.equal(body.user.isVerified, true)

  assert.equal(await User.countDocuments({ email: EMAIL }), 1, 'User row must now exist')
  assert.equal(await PendingSignup.countDocuments({ email: EMAIL }), 0, 'staging record must be cleared')

  // The stored credential must be the ORIGINAL password, not double-hashed.
  const withPass = await User.findOne({ email: EMAIL }).select('+password')
  const match = await withPass.comparePassword('Password1')
  assert.ok(match, 'password must be usable after migrating the hash')
})

await test('confirmed account can log in', async () => {
  const { res, body } = await invoke(login, loginSchema, { email: EMAIL, password: 'Password1' })
  assert.equal(res.statusCode, 200)
  assert.ok(body.token)
})

await test('resend-otp for a verified account does not send or error', async () => {
  const { res } = await invoke(resendOtp, resendOtpSchema, { email: EMAIL })
  assert.equal(res.statusCode, 200)
  assert.equal(await PendingSignup.countDocuments({ email: EMAIL }), 0, 'verified account must not be re-staged')
})

await test('signup with an email that already logged in still conflicts', async () => {
  await assert.rejects(
    () => invoke(signup, signupSchema, { name: 'Other', email: EMAIL, password: 'Password9' }),
    /already exists/,
  )
})

await mongoose.disconnect()
await mongod.stop()

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES PRESENT' : ''}`)
process.exit(process.exitCode || 0)

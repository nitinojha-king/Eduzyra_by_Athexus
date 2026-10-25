// One-off cleanup: OTP signup and password-reset were removed in favour of
// Google Sign-In. Run this once after deploying so stale auth fields and the
// PendingSignup collection do not linger in the database.
//
// Usage: node scripts/cleanup-auth-data.mjs
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'

const LEGACY_AUTH_FIELDS = [
  'isVerified',
  'otpCode',
  'otpExpires',
  'otpAttempts',
  'otpLastSentAt',
  'resetPasswordToken',
  'resetPasswordExpires',
]

async function run() {
  await connectDB()

  const unset = Object.fromEntries(LEGACY_AUTH_FIELDS.map((field) => [field, '']))
  const result = await mongoose.connection.db
    .collection('users')
    .updateMany({}, { $unset: unset })
  console.log(`Removed legacy auth fields from ${result.modifiedCount} user(s).`)

  const collections = await mongoose.connection.db
    .listCollections({ name: 'pendingsignups' })
    .toArray()
  if (collections.length > 0) {
    await mongoose.connection.db.dropCollection('pendingsignups')
    console.log('Dropped pendingsignups collection.')
  } else {
    console.log('No pendingsignups collection to drop.')
  }

  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

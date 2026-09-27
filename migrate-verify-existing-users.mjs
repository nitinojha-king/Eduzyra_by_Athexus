// One-off migration: the OTP email-verification feature adds a required
// `isVerified` gate to login. Accounts created BEFORE this feature shipped
// have no value for that field, which reads as falsy and would lock them
// out. Run this once after deploying the OTP change to grandfather in
// every pre-existing account as verified.
//
// Usage: node migrate-verify-existing-users.mjs
import 'dotenv/config'
import { connectDB } from './src/config/db.js'
import User from './src/models/User.js'

async function run() {
  await connectDB()

  const result = await User.updateMany(
    { isVerified: { $ne: true } },
    { $set: { isVerified: true } },
  )
  console.log(`Marked ${result.modifiedCount} existing user(s) as verified.`)
  process.exit(0)
}
run().catch((err) => { console.error(err); process.exit(1) })
